import { parsePlan } from "../plan/parse-plan.js";
import type { StoredRun } from "../ports/run-reader.js";
import type { AttemptRecord, EventRecord, TaskRecord } from "../ports/run-store.js";
import { liveLineOf, type TimelineEntry } from "./live-line.js";
import { traceEvents, type TaskTrace } from "./track-attempts.js";
import type {
  ActiveTask,
  AttemptView,
  BoardModel,
  BoardTotals,
  DeliveryItem,
  LiveLine,
  NodeId,
  NodeStatus,
  QueueItem,
  TaskState,
  TaskView,
  TokenTotals,
  WireView,
} from "./types.js";

export interface BoardInput {
  run: StoredRun;
  tasks: readonly TaskRecord[];
  attempts: readonly AttemptRecord[];
  /** Lifecycle events of the run, oldest first. */
  events: readonly EventRecord[];
  /** Agent timeline entries, oldest first. Only the live line reads them, so a recent window is enough. */
  agentEvents?: readonly TimelineEntry[];
  /** Current time in epoch milliseconds. The model never reads a clock; without it, open durations stay absent. */
  nowMs?: number;
}

const ZERO = (): TokenTotals => ({ input: 0, output: 0 });
const RUNNING_STATES: ReadonlySet<TaskState> = new Set(["running", "retrying", "verifying"]);

/**
 * Turns the records of one run into what the page draws.
 *
 * Task state (see docs/web-interface.md for the table):
 * - `pending` is queued, `passed` is delivered, `failed` is failed;
 * - `running` while the run is not running means the run died mid-task: failed;
 * - otherwise a `running` task is verifying when its open attempt started a check, retrying when an earlier attempt
 *   (number 1 or more) failed, and running in every other case. The open attempt is one with an `attempt.started`
 *   event and no `attempt.finished` event and no attempt row.
 */
export function buildBoard(input: BoardInput): BoardModel {
  const { run } = input;
  const live = run.status === "running";
  const traces = traceEvents(input.events);
  const order = input.tasks
    .map((record, index) => ({ record, position: record.position ?? index + 1, index }))
    .sort((a, b) => a.position - b.position || a.index - b.index);

  const models = modelsOf(run.planText);
  const tasks = order.map(({ record, position }) => buildTask(record, position, input, traces.get(record.taskId), live, models.get(record.taskId)));

  const queue: QueueItem[] = tasks
    .filter((t) => t.state === "queued")
    .map((t) => ({ taskId: t.taskId, title: t.title, position: t.position, ...(t.dependsOn ? { dependsOn: t.dependsOn } : {}) }));
  const delivery: DeliveryItem[] = tasks
    .filter((t) => t.state === "delivered")
    .map((t) => ({
      taskId: t.taskId,
      title: t.title,
      position: t.position,
      ...(t.branch ? { branch: t.branch } : {}),
      ...(t.commitSha ? { commitSha: t.commitSha } : {}),
      ...(t.prUrl ? { prUrl: t.prUrl } : {}),
    }));

  const current = tasks.find((t) => RUNNING_STATES.has(t.state));
  const open = current?.attempts.find((a) => a.status === "running" || a.status === "verifying");
  const active: ActiveTask | undefined = current && {
    taskId: current.taskId,
    title: current.title,
    state: current.state as ActiveTask["state"],
    ...(open ? { attempt: open.attempt, ...(open.startedAt ? { attemptStartedAt: open.startedAt } : {}) } : {}),
  };

  const line = liveLine(input, traces, current, open, live);

  return {
    runId: run.id,
    planName: run.planName,
    runStatus: run.status,
    startedAt: run.startedAt,
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    nodes: {
      claude: { status: "done", planName: run.planName, taskCount: tasks.length, hasPlanText: run.planText !== undefined },
      knit: { status: nodeStatus(run, "working"), ...(active ? { activeTaskId: active.taskId } : {}) },
      cursor: {
        status: nodeStatus(run, open?.status === "running" ? "working" : "idle"),
        ...(active ? { activeTaskId: active.taskId } : {}),
        ...(open?.status === "running" ? { attempt: open.attempt } : {}),
      },
    },
    wires: buildWires(tasks, live, queue.length > 0, open?.status),
    queue,
    ...(active ? { active } : {}),
    delivery,
    tasks,
    totals: buildTotals(run, tasks, input.nowMs),
    ...(line ? { liveLine: line } : {}),
  };
}

/** Knit and the builder follow the run's status; while it runs, `whileRunning` says what they are doing. */
function nodeStatus(run: StoredRun, whileRunning: NodeStatus): NodeStatus {
  if (run.status === "passed") return "done";
  if (run.status === "failed") return "failed";
  return whileRunning;
}

/** The `Model:` line of each task in the plan the run stored. Pure: a plan that does not parse names no models. */
function modelsOf(planText: string | undefined): Map<string, string> {
  const models = new Map<string, string>();
  if (planText === undefined) return models;
  let tasks: ReturnType<typeof parsePlan>["tasks"];
  try {
    tasks = parsePlan(planText).tasks;
  } catch {
    // A stored plan that no longer parses names no models; the board still draws the run.
    return models;
  }
  for (const task of tasks) if (task.model !== undefined) models.set(task.id, task.model);
  return models;
}

function buildTask(
  record: TaskRecord,
  position: number,
  input: BoardInput,
  trace: TaskTrace | undefined,
  live: boolean,
  model: string | undefined,
): TaskView {
  const rows = input.attempts.filter((a) => a.taskId === record.taskId);
  const attempts: AttemptView[] = rows.map((a) => ({
    attempt: a.attempt,
    setup: a.attempt === 0,
    status: a.status,
    startedAt: a.startedAt,
    durationMs: a.durationMs,
    ...(a.inputTokens !== undefined ? { inputTokens: a.inputTokens } : {}),
    ...(a.outputTokens !== undefined ? { outputTokens: a.outputTokens } : {}),
    ...(trace?.attempts.get(a.attempt)?.contextTokens !== undefined ? { contextTokens: trace.attempts.get(a.attempt)!.contextTokens! } : {}),
    ...(a.failedCheck !== undefined ? { failedCheck: a.failedCheck } : {}),
    scopeOk: a.scopeOk,
  }));

  // Open attempts: started, never finished, no row. Only the newest one of a live run is really running.
  const recorded = new Set(rows.map((a) => a.attempt));
  const openNumbers = [...(trace?.attempts ?? [])]
    .filter(([n, t]) => !t.finished && !recorded.has(n))
    .map(([n]) => n)
    .sort((a, b) => a - b);
  const newestOpen = openNumbers.at(-1);
  let verifying = false;
  for (const n of openNumbers) {
    const tracked = trace!.attempts.get(n)!;
    const isLive = live && n === newestOpen && record.status === "running";
    const status = !isLive ? "interrupted" : tracked.checking !== undefined ? "verifying" : "running";
    if (status === "verifying") verifying = true;
    attempts.push({
      attempt: n,
      setup: n === 0,
      status,
      startedAt: tracked.startedAt,
      ...(isLive && input.nowMs !== undefined ? { durationMs: Math.max(0, input.nowMs - Date.parse(tracked.startedAt)) } : {}),
      ...(status === "verifying" ? { checking: tracked.checking! } : {}),
    });
  }
  attempts.sort((a, b) => a.attempt - b.attempt);

  const failedBefore = rows.some((a) => a.attempt >= 1 && a.status === "failed");
  const state: TaskState =
    record.status === "passed" ? "delivered"
    : record.status === "failed" ? "failed"
    : record.status === "pending" ? "queued"
    : !live ? "failed"
    : verifying ? "verifying"
    : failedBefore ? "retrying"
    : "running";

  const tokens = ZERO();
  let durationMs = 0;
  for (const a of rows) {
    tokens.input += a.inputTokens ?? 0;
    tokens.output += a.outputTokens ?? 0;
    durationMs += a.durationMs;
  }

  return {
    taskId: record.taskId,
    title: record.title,
    state,
    position,
    ...(record.goal !== undefined ? { goal: record.goal } : {}),
    ...(record.dependsOn !== undefined ? { dependsOn: record.dependsOn } : {}),
    ...(model !== undefined ? { model } : {}),
    specs: record.specs ?? [],
    ...(record.branch !== undefined ? { branch: record.branch } : {}),
    ...(record.startSha !== undefined ? { startSha: record.startSha } : {}),
    ...(record.commitSha !== undefined ? { commitSha: record.commitSha } : {}),
    ...(record.prUrl !== undefined ? { prUrl: record.prUrl } : {}),
    ...(trace?.failureReason !== undefined && state === "failed" ? { failureReason: trace.failureReason } : {}),
    attempts,
    tokens,
    durationMs,
  };
}

function buildWires(tasks: TaskView[], live: boolean, hasQueue: boolean, open: AttemptView["status"] | undefined): WireView[] {
  const strand = (t: TaskView) => ({ taskId: t.taskId, state: t.state });
  const dispatched = tasks.filter((t) => t.attempts.some((a) => !a.setup));
  const returned = tasks.filter((t) => t.attempts.some((a) => !a.setup && (a.status === "passed" || a.status === "failed")));
  return [
    { id: "plan", from: "claude", to: "knit", active: live && hasQueue, strands: tasks.map(strand) },
    { id: "prompt", from: "knit", to: "cursor", active: open === "running", strands: dispatched.map(strand) },
    { id: "result", from: "cursor", to: "knit", active: open === "verifying", strands: returned.map(strand) },
  ];
}

function buildTotals(run: StoredRun, tasks: TaskView[], nowMs: number | undefined): BoardTotals {
  const cursor = ZERO();
  let agentMs = 0;
  let attempts = 0;
  const counts: BoardTotals["tasks"] = { total: tasks.length, queued: 0, running: 0, retrying: 0, verifying: 0, delivered: 0, failed: 0 };
  for (const t of tasks) {
    counts[t.state]++;
    cursor.input += t.tokens.input;
    cursor.output += t.tokens.output;
    agentMs += t.durationMs;
    attempts += t.attempts.filter((a) => a.status === "passed" || a.status === "failed").length;
  }
  const end = run.finishedAt !== undefined ? Date.parse(run.finishedAt) : nowMs;
  const tokens: Record<NodeId, TokenTotals> = { claude: ZERO(), knit: ZERO(), cursor };
  return {
    tokens,
    ...(end !== undefined ? { elapsedMs: Math.max(0, end - Date.parse(run.startedAt)) } : {}),
    agentMs,
    attempts,
    tasks: counts,
  };
}

/** While the agent works: its newest timeline entry. While Knit verifies: the check being run. */
function liveLine(
  input: BoardInput,
  traces: Map<string, TaskTrace>,
  current: TaskView | undefined,
  open: AttemptView | undefined,
  live: boolean,
): LiveLine | undefined {
  if (!live || !current || !open) return undefined;
  if (open.status === "verifying" && open.checking !== undefined) {
    const tracked = traces.get(current.taskId)?.attempts.get(open.attempt);
    return { source: "knit", kind: "check", text: open.checking, ts: tracked?.checkStartedAt ?? open.startedAt ?? "" };
  }
  return liveLineOf(input.agentEvents ?? [], current.taskId, open.attempt);
}

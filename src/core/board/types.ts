/**
 * View model of one run, drawn by the web page. Pure data: no Node, no adapters, so `web/` can `import type` it.
 * The exact rules that produce it are documented in docs/web-interface.md ("Read side and board view model").
 */
import type { RunStatus, TaskSpec } from "../ports/run-store.js";

/** The three blocks of the canvas, left to right. */
export type NodeId = "claude" | "knit" | "cursor";

export type NodeStatus = "idle" | "working" | "done" | "failed";

/** What a task looks like on the board. */
export type TaskState = "queued" | "running" | "retrying" | "verifying" | "delivered" | "failed";

/** `running`: the agent works. `verifying`: the agent finished and checks run. `interrupted`: the run stopped mid-attempt. */
export type AttemptState = "running" | "verifying" | "passed" | "failed" | "interrupted";

export interface TokenTotals {
  input: number;
  output: number;
}

export interface AttemptView {
  /** 0 is the setup phase. */
  attempt: number;
  setup: boolean;
  status: AttemptState;
  /** Absent only when neither the attempt row nor its `attempt.started` event exists. */
  startedAt?: string;
  /** Finished attempts: recorded. Open attempts: elapsed so far, when the caller passed `nowMs`. */
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** How much context the agent's chat carried after this attempt (fresh input plus cache); absent when it was not recorded. */
  contextTokens?: number;
  /** The check command that failed, or the setup command. */
  failedCheck?: string;
  /** Scope verdict: false when the agent changed files outside the task's allowed files. Absent while open. */
  scopeOk?: boolean;
  /** Command being checked right now (only while `verifying`). */
  checking?: string;
}

export interface TaskView {
  taskId: string;
  title: string;
  state: TaskState;
  /** 1-based execution order. Runs created before schema 4 have no stored position: the order they were created in. */
  position: number;
  /** Absent on runs created before schema 4. */
  goal?: string;
  dependsOn?: string;
  /** The model the plan chose for the builder (its `Model:` line); absent when the plan names none, or the run has no plan text. */
  model?: string;
  /** Empty on runs created before schema 4. */
  specs: TaskSpec[];
  branch?: string;
  startSha?: string;
  commitSha?: string;
  prUrl?: string;
  /** Why the task failed, from its `task.failed` event. */
  failureReason?: string;
  attempts: AttemptView[];
  tokens: TokenTotals;
  /** Sum of the durations of the finished attempts. */
  durationMs: number;
}

export interface ClaudeNode {
  status: NodeStatus;
  planName: string;
  taskCount: number;
  /** True when the run stored the plan text (schema 4 and later). */
  hasPlanText: boolean;
}

export interface KnitNode {
  status: NodeStatus;
  activeTaskId?: string;
}

export interface CursorNode {
  status: NodeStatus;
  activeTaskId?: string;
  /** Attempt being executed by the agent (not while Knit verifies). */
  attempt?: number;
}

export interface WireStrand {
  taskId: string;
  state: TaskState;
}

export type WireId = "plan" | "prompt" | "result";

/** A wire between two blocks. `active` means something is travelling or being processed on it right now. */
export interface WireView {
  id: WireId;
  from: NodeId;
  to: NodeId;
  active: boolean;
  strands: WireStrand[];
}

export interface QueueItem {
  taskId: string;
  title: string;
  position: number;
  dependsOn?: string;
}

export interface ActiveTask {
  taskId: string;
  title: string;
  state: "running" | "retrying" | "verifying";
  /** The open attempt, when there is one (not during setup). */
  attempt?: number;
  attemptStartedAt?: string;
}

export interface DeliveryItem {
  taskId: string;
  title: string;
  position: number;
  branch?: string;
  commitSha?: string;
  prUrl?: string;
}

/** What is happening right now, from the newest agent event of the running attempt (or the check being run). */
export interface LiveLine {
  /** `claude`, `cursor`... or `knit` while a check runs. */
  source: string;
  kind: string;
  text: string;
  ts: string;
  /** `agent_events.id`, when the source record carried one. */
  eventId?: number;
}

export interface BoardTotals {
  /** Attempts are executed by the builder agent; Knit never calls a model, and Claude's turns are sessions, not attempts. */
  tokens: Record<NodeId, TokenTotals>;
  /** Run start to finish, or to `nowMs` while running. Absent for a running run when `nowMs` was not given. */
  elapsedMs?: number;
  /** Sum of the durations of every finished attempt. */
  agentMs: number;
  attempts: number;
  tasks: Record<TaskState, number> & { total: number };
}

export interface BoardModel {
  runId: string;
  planName: string;
  runStatus: RunStatus;
  startedAt: string;
  finishedAt?: string;
  nodes: { claude: ClaudeNode; knit: KnitNode; cursor: CursorNode };
  /** Always `plan`, `prompt`, `result`, in that order. */
  wires: WireView[];
  /** Tasks still to run, in execution order. */
  queue: QueueItem[];
  active?: ActiveTask;
  /** Passed tasks, in execution order. */
  delivery: DeliveryItem[];
  /** Every task, in execution order. */
  tasks: TaskView[];
  totals: BoardTotals;
  liveLine?: LiveLine;
}

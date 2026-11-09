/**
 * Typed `BoardModel` samples that the canvas draws until it is wired to live data.
 * Together they cover every task state, a plan with `Depends:` links, a long queue, token totals,
 * a live line and a run recorded before schema 4. The types come from `src/core/board` (type-only import).
 *
 * `makeBoard` derives queue, delivery, wires and totals from the tasks with simple rules, so each sample
 * only has to say what its tasks look like. The authoritative rules are in `src/core/board/build-board.ts`;
 * this helper never replaces them, it only keeps hand-written samples consistent.
 */
import type { AttemptView, BoardModel, LiveLine, NodeStatus, TaskState, TaskView, WireStrand, WireView } from "@board";

type Specs = TaskView["specs"];

interface TaskInit extends Partial<Omit<TaskView, "taskId" | "title" | "state">> {
  taskId: string;
  title: string;
  state: TaskState;
}

function task(position: number, init: TaskInit): TaskView {
  return { position, specs: [], attempts: [], tokens: { input: 0, output: 0 }, durationMs: 0, ...init };
}

const MIN = 60_000;
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 3, 9, 0, 0) + minutes * MIN).toISOString();

function attempt(n: number, status: AttemptView["status"], init: Partial<AttemptView> = {}): AttemptView {
  return { attempt: n, setup: n === 0, status, ...init };
}

const specs = (...texts: string[]): Specs => texts.map((text, i) => ({ id: `S${i + 1}`, text }));

interface BoardInit {
  runId: string;
  planName: string;
  runStatus: BoardModel["runStatus"];
  tasks: TaskView[];
  startedAt?: string;
  finishedAt?: string;
  /** False for a run recorded before schema 4. */
  hasPlanText?: boolean;
  claudeTokens?: { input: number; output: number };
  liveLine?: LiveLine;
  elapsedMs?: number;
}

const OPEN_STATES: TaskState[] = ["running", "retrying", "verifying"];

function makeBoard(init: BoardInit): BoardModel {
  const { tasks, runStatus } = init;
  const open = tasks.find((t) => OPEN_STATES.includes(t.state));
  const queued = tasks.filter((t) => t.state === "queued");
  const delivered = tasks.filter((t) => t.state === "delivered");

  const strands = (include: (t: TaskView) => boolean): WireStrand[] =>
    tasks.filter(include).map((t) => ({ taskId: t.taskId, state: t.state }));
  const hasFinishedAttempt = (t: TaskView) => t.attempts.some((a) => !a.setup && (a.status === "passed" || a.status === "failed"));
  const wires: WireView[] = [
    { id: "plan", from: "claude", to: "knit", active: runStatus === "running" && queued.length > 0, strands: strands(() => true) },
    { id: "prompt", from: "knit", to: "cursor", active: open?.state === "running" || open?.state === "retrying", strands: strands((t) => t.state !== "queued") },
    { id: "result", from: "cursor", to: "knit", active: open?.state === "verifying", strands: strands(hasFinishedAttempt) },
  ];

  const count = (state: TaskState) => tasks.filter((t) => t.state === state).length;
  const sum = (pick: (t: TaskView) => number) => tasks.reduce((total, t) => total + pick(t), 0);
  const endStatus: NodeStatus = runStatus === "running" ? "working" : runStatus === "passed" ? "done" : "failed";
  const cursorWorking = open?.state === "running" || open?.state === "retrying";
  const openAttempt = open?.attempts.find((a) => a.status === "running" || a.status === "verifying");

  const board: BoardModel = {
    runId: init.runId,
    planName: init.planName,
    runStatus,
    startedAt: init.startedAt ?? at(0),
    nodes: {
      claude: { status: "done", planName: init.planName, taskCount: tasks.length, hasPlanText: init.hasPlanText ?? true },
      knit: open ? { status: endStatus, activeTaskId: open.taskId } : { status: endStatus },
      cursor: {
        status: runStatus === "running" ? (cursorWorking ? "working" : "idle") : endStatus,
        ...(cursorWorking && open ? { activeTaskId: open.taskId, ...(openAttempt ? { attempt: openAttempt.attempt } : {}) } : {}),
      },
    },
    wires,
    queue: queued.map((t) => ({ taskId: t.taskId, title: t.title, position: t.position, ...(t.dependsOn ? { dependsOn: t.dependsOn } : {}) })),
    delivery: delivered.map((t) => ({
      taskId: t.taskId,
      title: t.title,
      position: t.position,
      ...(t.branch ? { branch: t.branch } : {}),
      ...(t.commitSha ? { commitSha: t.commitSha } : {}),
      ...(t.prUrl ? { prUrl: t.prUrl } : {}),
    })),
    tasks,
    totals: {
      tokens: {
        claude: init.claudeTokens ?? { input: 0, output: 0 },
        knit: { input: 0, output: 0 },
        cursor: { input: sum((t) => t.tokens.input), output: sum((t) => t.tokens.output) },
      },
      agentMs: sum((t) => t.durationMs),
      attempts: sum((t) => t.attempts.length),
      tasks: {
        total: tasks.length,
        queued: count("queued"),
        running: count("running"),
        retrying: count("retrying"),
        verifying: count("verifying"),
        delivered: count("delivered"),
        failed: count("failed"),
      },
      ...(init.elapsedMs === undefined ? {} : { elapsedMs: init.elapsedMs }),
    },
  };
  if (init.finishedAt) board.finishedAt = init.finishedAt;
  if (open) {
    board.active = {
      taskId: open.taskId,
      title: open.title,
      state: open.state as "running" | "retrying" | "verifying",
      ...(openAttempt ? { attempt: openAttempt.attempt, ...(openAttempt.startedAt ? { attemptStartedAt: openAttempt.startedAt } : {}) } : {}),
    };
  }
  if (init.liveLine) board.liveLine = init.liveLine;
  return board;
}

const PR = (n: number) => `https://github.com/acme/shop/pull/${n}`;

/** A delivered task of the webhooks plan, with its single passing attempt. */
const deliveredTask = (position: number, taskId: string, title: string, extra: Partial<TaskInit> = {}): TaskView =>
  task(position, {
    taskId,
    title,
    state: "delivered",
    branch: `knit/${taskId.toLowerCase()}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "")}`,
    commitSha: `${(position * 0x2f3a91 + 0xa1b2c3).toString(16).slice(0, 7)}`,
    prUrl: PR(40 + position),
    attempts: [attempt(0, "passed", { startedAt: at(position * 9), durationMs: 14_000 }), attempt(1, "passed", { startedAt: at(position * 9 + 1), durationMs: 5 * MIN, inputTokens: 38_200, outputTokens: 4_900, scopeOk: true })],
    tokens: { input: 38_200, output: 4_900 },
    durationMs: 5 * MIN + 14_000,
    ...extra,
  });

const WEBHOOK_PLAN = "add-billing-webhooks";

const webhookTitles = {
  T1: "Add the webhook event schema",
  T2: "Verify the signature of incoming events",
  T3: "Store events and make handling idempotent",
  T4: "Update subscription status from events",
  T5: "Send a receipt email after a paid invoice",
  T6: "Document the webhook endpoint",
};

const webhookGoal = (id: keyof typeof webhookTitles) =>
  ({
    T1: "Define typed events for invoice and subscription changes.",
    T2: "Reject any request whose signature does not match the shared secret.",
    T3: "Handling the same event twice must change nothing.",
    T4: "Keep the stored subscription status in step with the provider.",
    T5: "Email a receipt once, when an invoice is paid.",
    T6: "Describe the endpoint, the events and how to replay one.",
  })[id];

const webhookSpecs = (id: keyof typeof webhookTitles): Specs =>
  id === "T2"
    ? specs("A request with a missing or wrong signature gets HTTP 400 and is not stored.", "The comparison does not leak timing information.")
    : specs(webhookGoal(id));

const queuedTask = (position: number, id: keyof typeof webhookTitles, dependsOn?: keyof typeof webhookTitles): TaskView =>
  task(position, { taskId: id, title: webhookTitles[id], state: "queued", goal: webhookGoal(id), specs: webhookSpecs(id), ...(dependsOn ? { dependsOn } : {}) });

const doneWebhook = (position: number, id: keyof typeof webhookTitles): TaskView =>
  deliveredTask(position, id, webhookTitles[id], { goal: webhookGoal(id), specs: webhookSpecs(id) });

/** The agent works on T3: two tasks delivered, three queued with `Depends:` links. */
export const runningRun: BoardModel = makeBoard({
  runId: "run-2026-11-03-0900",
  planName: WEBHOOK_PLAN,
  runStatus: "running",
  elapsedMs: 21 * MIN,
  tasks: [
    doneWebhook(1, "T1"),
    doneWebhook(2, "T2"),
    task(3, {
      taskId: "T3",
      title: webhookTitles.T3,
      state: "running",
      goal: webhookGoal("T3"),
      specs: webhookSpecs("T3"),
      dependsOn: "T2",
      attempts: [attempt(0, "passed", { startedAt: at(19), durationMs: 12_000 }), attempt(1, "running", { startedAt: at(19.5), durationMs: 90_000 })],
      durationMs: 12_000,
    }),
    queuedTask(4, "T4", "T3"),
    queuedTask(5, "T5", "T4"),
    queuedTask(6, "T6"),
  ],
  liveLine: { source: "cursor", kind: "tool_started", text: "edit: src/billing/webhook-store.ts", ts: at(21), eventId: 482 },
});

/** The first attempt of T2 failed its checks; the agent is on the second. */
export const retryingRun: BoardModel = makeBoard({
  runId: "run-2026-11-03-1015",
  planName: WEBHOOK_PLAN,
  runStatus: "running",
  elapsedMs: 17 * MIN,
  tasks: [
    doneWebhook(1, "T1"),
    task(2, {
      taskId: "T2",
      title: webhookTitles.T2,
      state: "retrying",
      goal: webhookGoal("T2"),
      specs: webhookSpecs("T2"),
      attempts: [
        attempt(0, "passed", { startedAt: at(6), durationMs: 11_000 }),
        attempt(1, "failed", { startedAt: at(6.5), durationMs: 4 * MIN, inputTokens: 29_400, outputTokens: 3_100, failedCheck: "pnpm test", scopeOk: true }),
        attempt(2, "running", { startedAt: at(11), durationMs: 2 * MIN }),
      ],
      tokens: { input: 29_400, output: 3_100 },
      durationMs: 4 * MIN + 11_000,
    }),
    queuedTask(3, "T3", "T2"),
    queuedTask(4, "T4"),
  ],
  liveLine: { source: "cursor", kind: "message", text: "The test expects a 400 for a missing header, not a 401. Adjusting the handler.", ts: at(17), eventId: 611 },
});

/** The agent finished T2 and Knit is running its checks. */
export const verifyingRun: BoardModel = makeBoard({
  runId: "run-2026-11-03-1130",
  planName: WEBHOOK_PLAN,
  runStatus: "running",
  elapsedMs: 13 * MIN,
  tasks: [
    doneWebhook(1, "T1"),
    task(2, {
      taskId: "T2",
      title: webhookTitles.T2,
      state: "verifying",
      goal: webhookGoal("T2"),
      specs: webhookSpecs("T2"),
      attempts: [
        attempt(0, "passed", { startedAt: at(6), durationMs: 10_000 }),
        attempt(1, "verifying", { startedAt: at(6.5), durationMs: 5 * MIN + 30_000, inputTokens: 33_000, outputTokens: 4_200, checking: "pnpm typecheck" }),
      ],
      tokens: { input: 33_000, output: 4_200 },
      durationMs: 10_000,
    }),
    queuedTask(3, "T3", "T2"),
  ],
  liveLine: { source: "knit", kind: "check", text: "pnpm typecheck", ts: at(12.5) },
});

/** T2 used all its attempts and failed; the tasks after it never started. */
export const failedRun: BoardModel = makeBoard({
  runId: "run-2026-11-02-1600",
  planName: WEBHOOK_PLAN,
  runStatus: "failed",
  startedAt: at(-1000),
  finishedAt: at(-960),
  elapsedMs: 40 * MIN,
  tasks: [
    doneWebhook(1, "T1"),
    task(2, {
      taskId: "T2",
      title: webhookTitles.T2,
      state: "failed",
      goal: webhookGoal("T2"),
      specs: webhookSpecs("T2"),
      failureReason: "check failed after 3 attempts: pnpm test (exit 1)",
      attempts: [
        attempt(0, "passed", { startedAt: at(-994), durationMs: 10_000 }),
        attempt(1, "failed", { startedAt: at(-993), durationMs: 5 * MIN, inputTokens: 31_000, outputTokens: 3_800, failedCheck: "pnpm test", scopeOk: true }),
        attempt(2, "failed", { startedAt: at(-987), durationMs: 6 * MIN, inputTokens: 36_500, outputTokens: 4_400, failedCheck: "pnpm test", scopeOk: true }),
        attempt(3, "failed", { startedAt: at(-980), durationMs: 7 * MIN, inputTokens: 41_900, outputTokens: 5_100, failedCheck: "pnpm test", scopeOk: false }),
      ],
      tokens: { input: 109_400, output: 13_300 },
      durationMs: 18 * MIN + 10_000,
    }),
    queuedTask(3, "T3", "T2"),
    queuedTask(4, "T4"),
  ],
});

/** Every task delivered, each with its pull request. */
export const deliveredRun: BoardModel = makeBoard({
  runId: "run-2026-11-01-1400",
  planName: "rename-config-keys",
  runStatus: "passed",
  startedAt: at(-2000),
  finishedAt: at(-1975),
  elapsedMs: 25 * MIN,
  claudeTokens: { input: 52_000, output: 7_400 },
  tasks: [
    deliveredTask(1, "T1", "Read both the old and the new key", { goal: "Accept the old key for one release." }),
    deliveredTask(2, "T2", "Warn when the old key is used", { goal: "Print one warning per process.", dependsOn: "T1" }),
    deliveredTask(3, "T3", "Update the docs and the examples", { goal: "Use the new key everywhere.", dependsOn: "T2" }),
  ],
});

const QUEUE_TITLES = [
  "Add the Customer model",
  "Create the customers table",
  "Expose GET /customers",
  "Expose POST /customers",
  "Validate email addresses",
  "Paginate the customer list",
  "Add a search filter",
  "Write the OpenAPI entries",
];

/** One task running and eight waiting, linked in a chain with one branch that depends on the first task. */
export const longQueueRun: BoardModel = makeBoard({
  runId: "run-2026-11-03-1400",
  planName: "customers-api",
  runStatus: "running",
  elapsedMs: 3 * MIN,
  tasks: [
    task(1, {
      taskId: "T1",
      title: "Scaffold the customers module",
      state: "running",
      goal: "Create the empty module with its route registration.",
      attempts: [attempt(0, "passed", { startedAt: at(0), durationMs: 9_000 }), attempt(1, "running", { startedAt: at(0.5), durationMs: 2 * MIN })],
      durationMs: 9_000,
    }),
    ...QUEUE_TITLES.map((title, i) =>
      task(i + 2, { taskId: `T${i + 2}`, title, state: "queued", ...(i === 4 ? { dependsOn: "T1" } : { dependsOn: `T${i + 1}` }) }),
    ),
  ],
  liveLine: { source: "cursor", kind: "tool_started", text: "read: src/customers/index.ts", ts: at(3), eventId: 37 },
});

/** A run recorded before schema 4: no goals, specs, dependencies or plan text; positions are creation order. */
export const legacyRun: BoardModel = makeBoard({
  runId: "run-2026-05-12-0930",
  planName: "bump-node-version",
  runStatus: "failed",
  startedAt: at(-250_000),
  finishedAt: at(-249_980),
  hasPlanText: false,
  elapsedMs: 20 * MIN,
  tasks: [
    task(1, {
      taskId: "T1",
      title: "Raise the engines field to Node 20",
      state: "delivered",
      branch: "knit/t1-raise-the-engines-field",
      commitSha: "9c41e07",
      attempts: [attempt(1, "passed", { durationMs: 3 * MIN, inputTokens: 12_800, outputTokens: 1_600 })],
      tokens: { input: 12_800, output: 1_600 },
      durationMs: 3 * MIN,
    }),
    task(2, {
      taskId: "T2",
      title: "Update the CI matrix",
      state: "failed",
      failureReason: "check failed after 3 attempts: pnpm test (exit 1)",
      attempts: [attempt(1, "failed", { durationMs: 4 * MIN, failedCheck: "pnpm test" }), attempt(2, "failed", { durationMs: 5 * MIN, failedCheck: "pnpm test" })],
      tokens: { input: 27_500, output: 3_900 },
      durationMs: 9 * MIN,
    }),
    task(3, { taskId: "T3", title: "Drop the Node 18 notes from the README", state: "queued" }),
  ],
});

export const ALL_FIXTURES = { runningRun, retryingRun, verifyingRun, failedRun, deliveredRun, longQueueRun, legacyRun } as const;

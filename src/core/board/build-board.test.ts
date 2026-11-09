import { describe, expect, it } from "vitest";
import type { StoredRun } from "../ports/run-reader.js";
import type { AgentEventRecord, AttemptRecord, EventRecord, TaskRecord } from "../ports/run-store.js";
import { buildBoard, type BoardInput } from "./build-board.js";

const T0 = "2026-11-08T10:00:00.000Z";
const at = (seconds: number): string => new Date(Date.parse(T0) + seconds * 1000).toISOString();

const run = (extra: Partial<StoredRun> = {}): StoredRun => ({
  id: "run-1", planName: "demo", planPath: "/p", repo: "/r", base: "main@abc", startedAt: T0, status: "running", ...extra,
});
const task = (taskId: string, extra: Partial<TaskRecord> = {}): TaskRecord => ({
  runId: "run-1", taskId, title: `Task ${taskId}`, status: "pending", ...extra,
});
const attempt = (taskId: string, n: number, extra: Partial<AttemptRecord> = {}): AttemptRecord => ({
  runId: "run-1", taskId, attempt: n, startedAt: at(10), durationMs: 5000, exitCode: 0, isError: false, scopeOk: true,
  status: "passed", ...extra,
});
const ev = (type: string, taskId?: string, n?: number, extra: Partial<EventRecord> = {}, s = 0): EventRecord => ({
  runId: "run-1", ts: at(s), type, ...(taskId ? { taskId } : {}), ...(n !== undefined ? { attempt: n } : {}), ...extra,
});
const agentEv = (taskId: string, n: number, kind: string, payload: unknown, extra: Partial<AgentEventRecord> = {}) => ({
  runId: "run-1", taskId, attempt: n, ts: at(20), kind, payload, agent: "cursor", ...extra,
});
const board = (input: Partial<BoardInput> & Pick<BoardInput, "tasks">) =>
  buildBoard({ run: run(), attempts: [], events: [], ...input });

const stateOf = (b: ReturnType<typeof board>, id: string) => b.tasks.find((t) => t.taskId === id)!.state;

describe("task states", () => {
  it("queued: a pending task", () => {
    expect(stateOf(board({ tasks: [task("T1")] }), "T1")).toBe("queued");
  });

  it("running: a running task with an attempt open and no failed attempt before it", () => {
    const b = board({ tasks: [task("T1", { status: "running" })], events: [ev("task.started", "T1"), ev("attempt.started", "T1", 1)] });
    expect(stateOf(b, "T1")).toBe("running");
    expect(b.tasks[0]!.attempts).toEqual([expect.objectContaining({ attempt: 1, status: "running", startedAt: at(0) })]);
  });

  it("running: a running task during setup, before any attempt", () => {
    const b = board({ tasks: [task("T1", { status: "running" })], events: [ev("task.started", "T1"), ev("setup.started", "T1")] });
    expect(stateOf(b, "T1")).toBe("running");
    expect(b.active).toEqual({ taskId: "T1", title: "Task T1", state: "running" });
  });

  it("verifying: the open attempt started its checks", () => {
    const b = board({
      tasks: [task("T1", { status: "running" })],
      events: [ev("attempt.started", "T1", 1), ev("check.started", "T1", 1, { payload: { command: "pnpm test" } }, 5)],
    });
    expect(stateOf(b, "T1")).toBe("verifying");
    expect(b.tasks[0]!.attempts[0]).toMatchObject({ status: "verifying", checking: "pnpm test" });
    expect(b.active).toMatchObject({ taskId: "T1", state: "verifying", attempt: 1 });
  });

  it("retrying: an attempt opens after a failed one", () => {
    const b = board({
      tasks: [task("T1", { status: "running" })],
      attempts: [attempt("T1", 1, { status: "failed", failedCheck: "pnpm test" })],
      events: [ev("attempt.started", "T1", 1), ev("attempt.finished", "T1", 1), ev("attempt.started", "T1", 2, {}, 30)],
    });
    expect(stateOf(b, "T1")).toBe("retrying");
    expect(b.tasks[0]!.attempts.map((a) => [a.attempt, a.status])).toEqual([[1, "failed"], [2, "running"]]);
  });

  it("retrying: between a failed attempt and the next one", () => {
    const b = board({
      tasks: [task("T1", { status: "running" })],
      attempts: [attempt("T1", 1, { status: "failed" })],
      events: [ev("attempt.started", "T1", 1), ev("attempt.finished", "T1", 1)],
    });
    expect(stateOf(b, "T1")).toBe("retrying");
    expect(b.active).toMatchObject({ taskId: "T1", state: "retrying" });
    expect(b.active!.attempt).toBeUndefined();
  });

  it("verifying wins over retrying on a later attempt", () => {
    const b = board({
      tasks: [task("T1", { status: "running" })],
      attempts: [attempt("T1", 1, { status: "failed" })],
      events: [ev("attempt.started", "T1", 2), ev("check.started", "T1", 2, { payload: { command: "lint" } })],
    });
    expect(stateOf(b, "T1")).toBe("verifying");
  });

  it("a failed setup attempt does not make the task retrying", () => {
    const b = board({
      tasks: [task("T1", { status: "running" })],
      attempts: [attempt("T1", 0, { status: "failed", failedCheck: "pnpm install" })],
      events: [ev("attempt.started", "T1", 1)],
    });
    expect(stateOf(b, "T1")).toBe("running");
  });

  it("an attempt that started again after a crash (same number) is open, not finished", () => {
    const b = board({
      tasks: [task("T1", { status: "running" })],
      events: [ev("attempt.started", "T1", 1), ev("check.started", "T1", 1), ev("run.resumed"), ev("attempt.started", "T1", 1, {}, 60)],
    });
    expect(stateOf(b, "T1")).toBe("running");
    expect(b.tasks[0]!.attempts[0]).toMatchObject({ status: "running", startedAt: at(60) });
  });

  it("delivered: a passed task, with its commit and PR", () => {
    const b = board({
      tasks: [task("T1", { status: "passed", commitSha: "abc123", prUrl: "https://x/pr/1", branch: "orch/t1" })],
      attempts: [attempt("T1", 1)],
    });
    expect(stateOf(b, "T1")).toBe("delivered");
    expect(b.delivery).toEqual([{ taskId: "T1", title: "Task T1", position: 1, branch: "orch/t1", commitSha: "abc123", prUrl: "https://x/pr/1" }]);
  });

  it("failed: a failed task, with the reason of its task.failed event", () => {
    const b = board({
      tasks: [task("T1", { status: "failed" })],
      attempts: [attempt("T1", 1, { status: "failed", failedCheck: "pnpm test", scopeOk: false })],
      events: [ev("task.failed", "T1", undefined, { payload: { reason: "check failed: pnpm test", attempts: 1 } })],
    });
    expect(stateOf(b, "T1")).toBe("failed");
    expect(b.tasks[0]).toMatchObject({ failureReason: "check failed: pnpm test" });
    expect(b.tasks[0]!.attempts[0]).toMatchObject({ status: "failed", failedCheck: "pnpm test", scopeOk: false });
  });

  it("a task still running when its run is no longer running was interrupted: failed, with the attempt interrupted", () => {
    const b = board({
      run: run({ status: "failed", finishedAt: at(100) }),
      tasks: [task("T1", { status: "running" })],
      events: [ev("attempt.started", "T1", 1)],
    });
    expect(stateOf(b, "T1")).toBe("failed");
    expect(b.tasks[0]!.attempts[0]).toMatchObject({ status: "interrupted" });
    expect(b.active).toBeUndefined();
    expect(b.nodes.cursor.status).toBe("failed");
  });

  it("a task skipped after a failure stays queued", () => {
    const b = board({ run: run({ status: "failed", finishedAt: at(9) }), tasks: [task("T1", { status: "failed" }), task("T2")] });
    expect(b.tasks.map((t) => t.state)).toEqual(["failed", "queued"]);
    expect(b.queue.map((q) => q.taskId)).toEqual(["T2"]);
  });
});

describe("queue", () => {
  it("lists queued tasks in position order with their dependency", () => {
    const b = board({
      tasks: [
        task("T3", { position: 3, dependsOn: "T2" }),
        task("T1", { position: 1, status: "passed" }),
        task("T2", { position: 2, dependsOn: "T1" }),
      ],
    });
    expect(b.queue).toEqual([
      { taskId: "T2", title: "Task T2", position: 2, dependsOn: "T1" },
      { taskId: "T3", title: "Task T3", position: 3, dependsOn: "T2" },
    ]);
    expect(b.tasks.map((t) => t.taskId)).toEqual(["T1", "T2", "T3"]);
  });

  it("is empty when nothing is waiting", () => {
    expect(board({ tasks: [task("T1", { status: "passed" })] }).queue).toEqual([]);
  });
});

describe("delivery lane", () => {
  it("lists passed tasks in execution order, leaving out the other states", () => {
    const b = board({
      tasks: [
        task("T2", { position: 2, status: "passed", commitSha: "b" }),
        task("T1", { position: 1, status: "passed", commitSha: "a", prUrl: "u1" }),
        task("T3", { position: 3, status: "running" }),
      ],
    });
    expect(b.delivery.map((d) => [d.taskId, d.commitSha, d.prUrl])).toEqual([["T1", "a", "u1"], ["T2", "b", undefined]]);
  });
});

describe("nodes and wires", () => {
  const running = (): BoardInput & { events: EventRecord[] } => ({
    run: run(),
    tasks: [task("T1", { position: 1, status: "passed" }), task("T2", { position: 2, status: "running" }), task("T3", { position: 3 })],
    attempts: [attempt("T1", 1)],
    events: [ev("attempt.started", "T2", 1)],
  });

  it("while the agent works: cursor and knit work, the prompt wire is active", () => {
    const b = buildBoard(running());
    expect(b.nodes.claude).toMatchObject({ status: "done", planName: "demo", taskCount: 3, hasPlanText: false });
    expect(b.nodes.knit).toEqual({ status: "working", activeTaskId: "T2" });
    expect(b.nodes.cursor).toEqual({ status: "working", activeTaskId: "T2", attempt: 1 });
    expect(b.wires.map((w) => [w.id, w.from, w.to, w.active])).toEqual([
      ["plan", "claude", "knit", true],
      ["prompt", "knit", "cursor", true],
      ["result", "cursor", "knit", false],
    ]);
  });

  it("while checks run: cursor is idle and the result wire is active", () => {
    const input = running();
    input.events.push(ev("check.started", "T2", 1, { payload: { command: "pnpm test" } }));
    const b = buildBoard(input);
    expect(b.nodes.cursor).toEqual({ status: "idle", activeTaskId: "T2" });
    expect(b.wires.map((w) => w.active)).toEqual([true, false, true]);
  });

  it("carries one strand per task on the plan wire, and only the tasks that travelled on the others", () => {
    const b = buildBoard(running());
    expect(b.wires[0]!.strands).toEqual([
      { taskId: "T1", state: "delivered" },
      { taskId: "T2", state: "running" },
      { taskId: "T3", state: "queued" },
    ]);
    expect(b.wires[1]!.strands.map((s) => s.taskId)).toEqual(["T1", "T2"]);
    expect(b.wires[2]!.strands.map((s) => s.taskId)).toEqual(["T1"]);
  });

  it("a passed run: everything is done and no wire is active", () => {
    const b = board({
      run: run({ status: "passed", finishedAt: at(60), planText: "# plan" }),
      tasks: [task("T1", { status: "passed" })],
      attempts: [attempt("T1", 1)],
    });
    expect(b.nodes).toMatchObject({ claude: { status: "done", hasPlanText: true }, knit: { status: "done" }, cursor: { status: "done" } });
    expect(b.wires.every((w) => !w.active)).toBe(true);
  });

  it("a failed run marks knit and cursor failed", () => {
    const b = board({ run: run({ status: "failed", finishedAt: at(60) }), tasks: [task("T1", { status: "failed" })] });
    expect(b.nodes).toMatchObject({ knit: { status: "failed" }, cursor: { status: "failed" } });
  });

  it("a running run between tasks leaves cursor idle", () => {
    const b = board({ tasks: [task("T1", { status: "passed" }), task("T2")] });
    expect(b.nodes.knit).toEqual({ status: "working" });
    expect(b.nodes.cursor).toEqual({ status: "idle" });
    expect(b.active).toBeUndefined();
  });
});

describe("totals", () => {
  it("sums tokens per agent, time, attempts and task states", () => {
    const b = board({
      run: run({ status: "passed", finishedAt: at(90) }),
      tasks: [task("T1", { status: "passed" }), task("T2", { status: "passed" }), task("T3", { status: "failed" })],
      attempts: [
        attempt("T1", 1, { inputTokens: 100, outputTokens: 10, durationMs: 2000 }),
        attempt("T2", 1, { inputTokens: 50, outputTokens: 5, durationMs: 3000, status: "failed" }),
        attempt("T2", 2, { durationMs: 1000 }),
      ],
    });
    expect(b.totals).toEqual({
      tokens: { claude: { input: 0, output: 0 }, knit: { input: 0, output: 0 }, cursor: { input: 150, output: 15 } },
      elapsedMs: 90_000,
      agentMs: 6000,
      attempts: 3,
      tasks: { total: 3, queued: 0, running: 0, retrying: 0, verifying: 0, delivered: 2, failed: 1 },
    });
    expect(b.tasks[1]).toMatchObject({ tokens: { input: 50, output: 5 }, durationMs: 4000 });
  });

  it("elapsed time of a running run needs nowMs", () => {
    const input = { tasks: [task("T1", { status: "running" })], events: [ev("attempt.started", "T1", 1)] };
    expect(board(input).totals.elapsedMs).toBeUndefined();
    const b = board({ ...input, nowMs: Date.parse(T0) + 42_000 });
    expect(b.totals.elapsedMs).toBe(42_000);
    expect(b.tasks[0]!.attempts[0]).toMatchObject({ durationMs: 42_000 });
  });
});

describe("live line", () => {
  const open = [task("T1", { status: "running" })];

  it("is the newest agent event of the running attempt", () => {
    const b = board({
      tasks: open,
      events: [ev("attempt.started", "T1", 1)],
      agentEvents: [
        agentEv("T1", 1, "message", { text: "first" }),
        agentEv("T1", 1, "tool_started", { tool: "readToolCall", args: { path: "src/a.ts" } }, { ts: at(25) }),
        agentEv("T1", 0, "message", { text: "setup noise" }, { ts: at(30) }),
      ],
    });
    expect(b.liveLine).toEqual({ source: "cursor", kind: "tool_started", text: "read: src/a.ts", ts: at(25) });
  });

  it("carries the event id when the record has one", () => {
    const b = board({
      tasks: open,
      events: [ev("attempt.started", "T1", 1)],
      agentEvents: [{ ...agentEv("T1", 1, "thinking", { text: "  considering\n the options " }), id: 9 }],
    });
    expect(b.liveLine).toMatchObject({ kind: "thinking", text: "considering the options", eventId: 9 });
  });

  it("clips long text", () => {
    const b = board({
      tasks: open,
      events: [ev("attempt.started", "T1", 1)],
      agentEvents: [agentEv("T1", 1, "message", { text: "x".repeat(500) })],
    });
    expect(b.liveLine!.text.length).toBeLessThanOrEqual(160);
    expect(b.liveLine!.text.endsWith("…")).toBe(true);
  });

  it("is the check being run while verifying, attributed to knit", () => {
    const b = board({
      tasks: open,
      events: [ev("attempt.started", "T1", 1), ev("check.started", "T1", 1, { payload: { command: "pnpm test" } }, 40)],
      agentEvents: [agentEv("T1", 1, "message", { text: "done" })],
    });
    expect(b.liveLine).toEqual({ source: "knit", kind: "check", text: "pnpm test", ts: at(40) });
  });

  it("is absent when the run is not running, when no attempt is open, or when the attempt has no events yet", () => {
    const agentEvents = [agentEv("T1", 1, "message", { text: "hi" })];
    expect(board({ run: run({ status: "passed" }), tasks: [task("T1", { status: "passed" })], agentEvents }).liveLine).toBeUndefined();
    expect(board({ tasks: open, events: [ev("setup.started", "T1")], agentEvents }).liveLine).toBeUndefined();
    expect(board({ tasks: open, events: [ev("attempt.started", "T1", 1)] }).liveLine).toBeUndefined();
  });

  it("summarizes the other kinds", () => {
    const line = (kind: string, payload: unknown) =>
      board({ tasks: open, events: [ev("attempt.started", "T1", 1)], agentEvents: [agentEv("T1", 1, kind, payload)] }).liveLine!.text;
    expect(line("tool_completed", { tool: "shellToolCall" })).toBe("shell: done");
    expect(line("tool_started", { tool: "shellToolCall", args: { command: "ls -la" } })).toBe("shell: ls -la");
    expect(line("tool_started", { tool: "weirdToolCall" })).toBe("weird");
    expect(line("prompt", { text: "Do the thing" })).toBe("Do the thing");
    expect(line("system", { model: "m" })).toBe("session started");
    expect(line("result", { text: "All good" })).toBe("All good");
    expect(line("other", { type: "ping" })).toBe("ping");
  });
});

describe("a run created before schema 4", () => {
  it("has no goal, specs, position, dependencies or plan text, and still produces a board", () => {
    const b = board({
      run: run({ status: "passed", finishedAt: at(30) }),
      tasks: [task("T1", { status: "passed", commitSha: "a" }), task("T2", { status: "passed", commitSha: "b" })],
      attempts: [attempt("T1", 1, { inputTokens: 7, outputTokens: 3 }), attempt("T2", 1)],
    });
    expect(b.tasks.map((t) => [t.taskId, t.position, t.goal, t.dependsOn, t.specs])).toEqual([
      ["T1", 1, undefined, undefined, []],
      ["T2", 2, undefined, undefined, []],
    ]);
    expect(b.nodes.claude.hasPlanText).toBe(false);
    expect(b.delivery.map((d) => d.taskId)).toEqual(["T1", "T2"]);
    expect(b.totals.tokens.cursor).toEqual({ input: 7, output: 3 });
  });

  it("keeps the creation order for queued tasks without a position", () => {
    const b = board({ tasks: [task("B"), task("A")] });
    expect(b.queue.map((q) => [q.taskId, q.position])).toEqual([["B", 1], ["A", 2]]);
  });
});

describe("task details", () => {
  it("passes goal, specs and dependency through and orders attempts, setup first", () => {
    const b = board({
      tasks: [task("T1", { goal: "g", dependsOn: "T0", specs: [{ id: "S1", text: "x" }], position: 1, status: "passed" })],
      attempts: [attempt("T1", 2), attempt("T1", 0, { status: "failed", failedCheck: "install" }), attempt("T1", 1, { status: "failed" })],
    });
    expect(b.tasks[0]).toMatchObject({ goal: "g", dependsOn: "T0", specs: [{ id: "S1", text: "x" }] });
    expect(b.tasks[0]!.attempts.map((a) => [a.attempt, a.setup])).toEqual([[0, true], [1, false], [2, false]]);
  });
});

describe("the model of each task, from the plan the run stored", () => {
  const PLAN = `# Plan: demo

## T1: First

Branch: feat/one
Model: composer-2.5-fast
Goal: first.
Specs:
- S1: first spec.
Allowed files:
- src/a.ts
Checks:
- true

## T2: Second

Branch: feat/two
Depends: T1
Goal: second.
Specs:
- S1: second spec.
Allowed files:
- src/b.ts
Checks:
- true
`;

  it("gives each task the model its plan names, and none when the plan names none", () => {
    const b = board({ run: run({ planText: PLAN }), tasks: [task("T1"), task("T2")] });
    expect(b.tasks.find((t) => t.taskId === "T1")!.model).toBe("composer-2.5-fast");
    expect(b.tasks.find((t) => t.taskId === "T2")!.model).toBeUndefined();
  });

  it("names no models for a stored plan that does not parse, and still draws the run", () => {
    const b = board({ run: run({ planText: "not a plan" }), tasks: [task("T1")] });
    expect(b.tasks[0]!.model).toBeUndefined();
  });

  it("has no model for any task when the run has no plan text", () => {
    const b = board({ tasks: [task("T1")] });
    expect(b.tasks[0]!.model).toBeUndefined();
  });
});

describe("the context of each attempt's chat", () => {
  it("carries what attempt.finished recorded, and nothing for an attempt that recorded none (older runs)", () => {
    const b = board({
      tasks: [task("T1", { status: "passed" })],
      attempts: [attempt("T1", 1), attempt("T1", 2)],
      events: [
        ev("attempt.started", "T1", 1),
        ev("attempt.finished", "T1", 1, { payload: { passed: false, contextTokens: 12_381 } }, 5),
        ev("attempt.started", "T1", 2, {}, 6),
        ev("attempt.finished", "T1", 2, { payload: { passed: true } }, 9),
      ],
    });
    const [first, second] = b.tasks[0]!.attempts;
    expect(first!.contextTokens).toBe(12_381);
    expect(second!.contextTokens).toBeUndefined();
  });

  it("ignores a context that is not a number", () => {
    const b = board({
      tasks: [task("T1", { status: "passed" })],
      attempts: [attempt("T1", 1)],
      events: [ev("attempt.started", "T1", 1), ev("attempt.finished", "T1", 1, { payload: { contextTokens: "lots" } }, 5)],
    });
    expect(b.tasks[0]!.attempts[0]!.contextTokens).toBeUndefined();
  });
});


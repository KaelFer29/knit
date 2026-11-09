import { describe, expect, it } from "vitest";
import { parsePlan, type ResolvedPlan } from "../plan/parse-plan.js";
import { runPlan, type RunOptions } from "./run-plan.js";
import type { AgentEvent, AgentRunRequest, AgentRunResult, AgentRunner } from "../ports/agent-runner.js";
import type { Transcript, TranscriptStore } from "../ports/transcript.js";
import type { CheckResult, CheckRunner } from "../ports/check-runner.js";
import type { CreatePullRequestInput, PullRequests } from "../ports/pull-requests.js";
import type {
  AgentEventRecord,
  AttemptRecord,
  EventRecord,
  RunRecord,
  RunStatus,
  RunStore,
  TaskRecord,
} from "../ports/run-store.js";
import type { BaseRef, GitInspection, PrepareWorkspaceInput, TaskWorkspace, Workspace } from "../ports/workspace.js";

const PLAN_MD = `# Plan: demo

Repo: /repo
Setup:
- pnpm install

## T1: First

Branch: feat/first
Goal: Do first.
Specs:
- S1: first spec
Allowed files:
- src/a.ts
Checks:
- npm test

## T2: Second

Branch: feat/second
Depends: T1
Goal: Do second.
Specs:
- S1: second spec
Allowed files:
- src/b.ts
Checks:
- npm test
`;

const plan = (md = PLAN_MD) => parsePlan(md) as ResolvedPlan;

interface State {
  changed: string[];
  outside: string[];
  inspection: Partial<GitInspection>;
}

interface Options {
  agent?: (call: number, req: AgentRunRequest, state: State) => Partial<AgentRunResult> | void;
  check?: (command: string, call: number) => Partial<CheckResult>;
  base?: BaseRef;
  prepareThrows?: boolean;
  pushThrows?: boolean;
  prThrows?: boolean;
  attachResult?: "ok" | "gone";
  existing?: TaskRecord[];
  nextAttemptStart?: number;
  planMd?: string;
  /** Raw agent events emitted on every agent call. */
  agentEvents?: AgentEvent[];
  agentThrows?: boolean;
}

function harness(options: Options = {}) {
  const state: State = { changed: [], outside: [], inspection: {} };
  const prompts: string[] = [];
  const requests: AgentRunRequest[] = [];
  const prepared: PrepareWorkspaceInput[] = [];
  const attached: string[] = [];
  const pushed: string[] = [];
  const created: CreatePullRequestInput[] = [];
  const checkCalls: { command: string; cwd: string }[] = [];
  const order: string[] = [];
  const attempts: AttemptRecord[] = [];
  const events: EventRecord[] = [];
  const agentRecords: AgentEventRecord[] = [];
  const transcripts: { ctx: { runId: string; taskId: string; attempt: number }; raw: unknown[]; closed: boolean }[] = [];
  const tasks = new Map<string, TaskRecord>((options.existing ?? []).map((t) => [t.taskId, t]));
  const runs: { created?: RunRecord; status?: RunStatus; reopened?: boolean; reopenPid?: number } = {};
  let agentCalls = 0;
  let preflights = 0;

  const agent: AgentRunner = {
    name: "fake-agent",
    run: async (req, onEvent) => {
      order.push("agent");
      prompts.push(req.prompt);
      requests.push(req);
      for (const e of options.agentEvents ?? []) onEvent?.(e);
      if (options.agentThrows) throw new Error("agent exploded");
      const override = options.agent?.(agentCalls++, req, state) ?? {};
      return { exitCode: 0, isError: false, resultText: "done", durationMs: 7, timedOut: false, ...override };
    },
  };
  const checks: CheckRunner = {
    run: async (command, cwd) => {
      order.push(`check:${command}`);
      checkCalls.push({ command, cwd });
      const override = options.check?.(command, checkCalls.length - 1) ?? {};
      return { command, exitCode: 0, output: "", timedOut: false, durationMs: 1, ...override };
    },
  };
  const wsFor = (path: string, branch: string, startSha: string): TaskWorkspace => ({ path, branch, startSha });
  const workspace: Workspace = {
    resolveBase: () => options.base ?? { sha: "basesha", branch: "main" },
    prepare: (input) => {
      if (options.prepareThrows) throw new Error("branch already exists");
      prepared.push(input);
      state.changed = [];
      state.outside = [];
      return wsFor(`/w/${input.runId}/${input.taskId}/repo`, input.branch, `start-${input.taskId}`);
    },
    attach: (input) => {
      attached.push(input.path);
      return options.attachResult === "gone" ? undefined : wsFor(input.path, input.branch, input.startSha);
    },
    changedPaths: () => [...state.changed],
    outsideChanges: () => [...state.outside],
    inspect: (ws) => ({
      branch: ws.branch,
      historyIntact: true,
      commits: [{ sha: `sha-${ws.branch}`, subject: "feat(core): work", body: "" }],
      uncommitted: [],
      ...state.inspection,
    }),
    push: (ws) => {
      if (options.pushThrows) throw new Error("remote rejected");
      pushed.push(ws.branch);
    },
  };
  const pullRequests: PullRequests = {
    preflight: () => void preflights++,
    create: (input) => {
      if (options.prThrows) throw new Error("gh exploded");
      created.push(input);
      return { url: `https://example.test/pull/${created.length}` };
    },
  };
  const store: RunStore = {
    createRun: (r) => void (runs.created = r),
    finishRun: (_id, status) => void (runs.status = status),
    reopenRun: (_id, pid) => {
      runs.reopened = true;
      if (pid !== undefined) runs.reopenPid = pid;
    },
    upsertTask: (t) => void tasks.set(t.taskId, { ...tasks.get(t.taskId), ...t }),
    getTasks: () => [...tasks.values()],
    nextAttempt: () => options.nextAttemptStart ?? 1,
    recordAttempt: (a) => void attempts.push(a),
    recordEvent: (e) => void events.push(e),
    recordAgentEvent: (e) => void agentRecords.push(e),
  };
  const transcriptStore: TranscriptStore = {
    open: (ctx) => {
      const entry = { ctx, raw: [] as unknown[], closed: false };
      transcripts.push(entry);
      const t: Transcript = { path: `/logs/${ctx.taskId}-${ctx.attempt}`, append: (e) => void entry.raw.push(e.raw), close: () => void (entry.closed = true) };
      return t;
    },
  };

  const run = (extra: Partial<RunOptions> = {}, withPrs = true) =>
    runPlan(
      plan(options.planMd),
      { agent, checks, workspace, store, transcripts: transcriptStore, ...(withPrs ? { pullRequests } : {}), now: () => new Date("2026-11-08T10:00:00.000Z") },
      { runId: "run-1", planPath: "/p/plan.md", ...extra },
    );

  return {
    run, state, prompts, requests, prepared, attached, pushed, created, checkCalls, order, attempts, events, tasks, runs, agentRecords, transcripts,
    preflights: () => preflights,
  };
}

/** Agent script: sets the changed files, one set per call (the last set repeats). */
const writes = (...perCall: string[][]): Options["agent"] => (call, _req, state) => {
  state.changed = perCall[Math.min(call, perCall.length - 1)] ?? [];
};

describe("runPlan: core loop", () => {
  it("runs setup, agent and checks per task and chains dependent tasks from the parent branch", async () => {
    const h = harness({ agent: (call, _r, s) => void (s.changed = [call === 0 ? "src/a.ts" : "src/b.ts"]) });
    const summary = await h.run();
    expect(summary.status).toBe("passed");
    expect(summary.tasks).toEqual([
      { taskId: "T1", status: "passed", attempts: 1, commitSha: "sha-feat/first" },
      { taskId: "T2", status: "passed", attempts: 1, commitSha: "sha-feat/second" },
    ]);
    expect(h.prepared.map((p) => [p.taskId, p.branch, p.startPoint])).toEqual([
      ["T1", "feat/first", "basesha"],
      ["T2", "feat/second", "feat/first"],
    ]);
    expect(h.order.slice(0, 3)).toEqual(["check:pnpm install", "agent", "check:npm test"]);
    expect(h.checkCalls[0]!.cwd).toBe("/w/run-1/T1/repo");
    expect(h.runs.status).toBe("passed");
    expect(h.tasks.get("T2")).toMatchObject({ status: "passed", commitSha: "sha-feat/second", branch: "feat/second", startSha: "start-T2" });
  });

  it("starts independent tasks from the plan base, not from the previous task", async () => {
    const h = harness({ planMd: PLAN_MD.replace("Depends: T1\n", ""), agent: writes(["src/a.ts"], ["src/b.ts"]) });
    await h.run();
    expect(h.prepared.map((p) => p.startPoint)).toEqual(["basesha", "basesha"]);
  });

  it("records the run with the base label and all tasks as pending first", async () => {
    const h = harness({ agent: writes(["src/a.ts"], ["src/b.ts"]) });
    await h.run();
    expect(h.runs.created).toMatchObject({ id: "run-1", planName: "demo", repo: "/repo", base: "main@basesha" });
    expect(h.events[0]).toMatchObject({ type: "run.started" });
    expect(h.events.at(-1)).toMatchObject({ type: "run.finished", payload: { status: "passed" } });
  });

  it("records the plan snapshot: plan text, pid and each task's goal, dependency, position and specs", async () => {
    const h = harness({ agent: writes(["src/a.ts"], ["src/b.ts"]) });
    await h.run({ planText: PLAN_MD, pid: 1234 });
    expect(h.runs.created).toMatchObject({ planText: PLAN_MD, pid: 1234 });
    expect(h.tasks.get("T1")).toMatchObject({ goal: "Do first.", position: 1, specs: [{ id: "S1", text: "first spec" }] });
    expect(h.tasks.get("T1")?.dependsOn).toBeUndefined();
    expect(h.tasks.get("T2")).toMatchObject({
      goal: "Do second.",
      dependsOn: "T1",
      position: 2,
      specs: [{ id: "S1", text: "second spec" }],
    });
  });

  it("runs a task with the model its plan names, on every attempt, and the others with the agent's own default", async () => {
    const md = PLAN_MD.replace("Branch: feat/first\n", "Branch: feat/first\nModel: composer-2.5\n");
    const h = harness({
      planMd: md,
      agent: writes(["src/a.ts"], ["src/a.ts"], ["src/b.ts"]),
      check: (command, call) => (command === "npm test" && call === 1 ? { exitCode: 1, output: "FAIL" } : {}),
    });
    await h.run();
    expect(h.requests[0]!.profile).toEqual({ model: "composer-2.5" });
    expect(h.requests[1]!.profile).toEqual({ model: "composer-2.5" });
    expect(h.requests[2]!.profile).toBeUndefined();
  });

  it("never commits itself: the agent owns the commits", async () => {
    const h = harness({ agent: writes(["src/a.ts"], ["src/b.ts"]) });
    await h.run();
    expect(Object.keys(h.prepared[0]!)).not.toContain("commit");
  });

  it("retries with the failed check output and then passes", async () => {
    const h = harness({
      agent: writes(["src/a.ts"], ["src/a.ts"], ["src/b.ts"]),
      check: (command, call) => (command === "npm test" && call === 1 ? { exitCode: 1, output: "FAIL: expected 1 got 2" } : {}),
    });
    const summary = await h.run();
    expect(summary.tasks[0]).toMatchObject({ status: "passed", attempts: 2 });
    expect(h.prompts[0]).not.toContain("Previous attempt failed");
    expect(h.prompts[1]).toContain("Failed check: npm test");
    expect(h.prompts[1]).toContain("FAIL: expected 1 got 2");
    expect(h.attempts.filter((a) => a.taskId === "T1").map((a) => [a.attempt, a.status, a.failedCheck])).toEqual([
      [1, "failed", "npm test"],
      [2, "passed", undefined],
    ]);
  });

  it("fails an attempt on scope violations without running checks, and tells the agent", async () => {
    const h = harness({ agent: writes(["src/a.ts", "README.md"], ["src/a.ts"], ["src/b.ts"]) });
    const summary = await h.run();
    expect(summary.tasks[0]!.attempts).toBe(2);
    expect(h.attempts[0]).toMatchObject({ scopeOk: false, status: "failed" });
    expect(h.checkCalls.filter((c) => c.command === "npm test")).toHaveLength(2); // T1 attempt 2 and T2 attempt 1
    expect(h.prompts[1]).toContain("Files changed outside the allowed list (revert them):\n- README.md");
  });

  it("treats entries created next to the worktree as scope violations", async () => {
    const h = harness({
      agent: (call, _r, s) => {
        s.changed = [call === 2 ? "src/b.ts" : "src/a.ts"];
        s.outside = call === 0 ? ["../outside.txt"] : [];
      },
    });
    await h.run();
    expect(h.attempts[0]).toMatchObject({ scopeOk: false });
    expect(h.prompts[1]).toContain("- ../outside.txt");
  });

  it("fails the task and run after max attempts, skipping later tasks", async () => {
    const h = harness({ agent: writes(["src/a.ts"]), check: (c) => (c === "npm test" ? { exitCode: 1, output: "boom" } : {}) });
    const summary = await h.run();
    expect(summary.status).toBe("failed");
    expect(summary.tasks).toEqual([
      { taskId: "T1", status: "failed", attempts: 2, reason: "Check failed: npm test" },
      { taskId: "T2", status: "skipped", attempts: 0 },
    ]);
    expect(h.prepared.map((p) => p.taskId)).toEqual(["T1"]);
    expect(h.runs.status).toBe("failed");
    expect(h.tasks.get("T1")!.status).toBe("failed");
    expect(h.tasks.get("T2")!.status).toBe("pending");
  });

  it("respects maxAttempts", async () => {
    const h = harness({ agent: writes(["src/a.ts"]), check: (c) => (c === "npm test" ? { exitCode: 1 } : {}) });
    const summary = await h.run({ maxAttempts: 1 });
    expect(summary.tasks[0]!.attempts).toBe(1);
    expect(h.prompts).toHaveLength(1);
  });

  it("retries after an agent process failure and mentions the problem", async () => {
    const h = harness({
      agent: (call, _r, s) => {
        s.changed = [call === 2 ? "src/b.ts" : "src/a.ts"];
        if (call === 0) return { exitCode: 1, isError: true, resultText: "model exploded" };
      },
    });
    const summary = await h.run();
    expect(summary.tasks[0]).toMatchObject({ status: "passed", attempts: 2 });
    expect(h.prompts[1]).toContain("Problem: The agent process failed (exit code 1): model exploded");
    expect(h.attempts[0]).toMatchObject({ isError: true, exitCode: 1, status: "failed" });
  });

  it("reports a timeout as the problem", async () => {
    const h = harness({
      agent: (call, _r, s) => {
        s.changed = [call === 2 ? "src/b.ts" : "src/a.ts"];
        if (call === 0) return { exitCode: null, isError: true, timedOut: true, resultText: "Agent timed out" };
      },
    });
    await h.run();
    expect(h.prompts[1]).toContain("Problem: The agent timed out.");
  });

  it("fails an attempt that changed nothing", async () => {
    const h = harness({ agent: (call, _r, s) => void (s.changed = call === 0 ? [] : [call === 1 ? "src/a.ts" : "src/b.ts"]) });
    const summary = await h.run();
    expect(summary.tasks[0]!.attempts).toBe(2);
    expect(h.prompts[1]).toContain("Problem: No files were changed.");
  });

  it("fails the task without calling the agent when setup fails", async () => {
    const h = harness({ check: (c) => (c === "pnpm install" ? { exitCode: 1, output: "ERR_PNPM" } : {}) });
    const summary = await h.run();
    expect(summary.tasks[0]).toEqual({ taskId: "T1", status: "failed", attempts: 0, reason: "Setup failed: pnpm install" });
    expect(h.prompts).toEqual([]);
    expect(h.attempts[0]).toMatchObject({ attempt: 0, status: "failed", failedCheck: "pnpm install" });
  });

  it("turns an unexpected workspace error into a failed task instead of throwing", async () => {
    const h = harness({ prepareThrows: true });
    const summary = await h.run();
    expect(summary.status).toBe("failed");
    expect(summary.tasks[0]).toMatchObject({ status: "failed", attempts: 0 });
    expect(summary.tasks[0]!.reason).toContain("branch already exists");
    expect(h.runs.status).toBe("failed");
  });

  it("stores tool_call events from the agent as compact progress events", async () => {
    const events: EventRecord[] = [];
    const agent: AgentRunner = {
      run: async (_req, onEvent) => {
        onEvent?.({ type: "tool_call", raw: { type: "tool_call", subtype: "started", call_id: "c1", tool_call: { editToolCall: {} } } });
        onEvent?.({ type: "thinking", raw: { type: "thinking" } });
        return { exitCode: 0, isError: false, resultText: "ok", durationMs: 1, timedOut: false };
      },
    };
    await runPlan(
      plan(PLAN_MD.replace(/## T2[\s\S]*/, "")),
      {
        agent,
        checks: { run: async (command) => ({ command, exitCode: 0, output: "", timedOut: false, durationMs: 1 }) },
        workspace: {
          resolveBase: () => ({ sha: "b" }),
          prepare: (i) => ({ path: `/w/${i.taskId}`, branch: i.branch, startSha: "s" }),
          attach: () => undefined,
          changedPaths: () => ["src/a.ts"],
          outsideChanges: () => [],
          inspect: (ws) => ({ branch: ws.branch, historyIntact: true, commits: [{ sha: "x", subject: "feat: w", body: "" }], uncommitted: [] }),
          push: () => {},
        },
        store: {
          createRun() {}, finishRun() {}, reopenRun() {}, getTasks: () => [], nextAttempt: () => 1,
          upsertTask() {}, recordAttempt() {}, recordEvent: (e) => void events.push(e), recordAgentEvent() {},
        },
      },
      { runId: "r", planPath: "p" },
    );
    const agentEvents = events.filter((e) => e.type === "agent.tool_call");
    expect(agentEvents).toHaveLength(1);
    expect(agentEvents[0]).toMatchObject({ taskId: "T1", attempt: 1, payload: { subtype: "started", callId: "c1", tool: "editToolCall" } });
  });
});

describe("runPlan: agent transcript", () => {
  const STREAM: AgentEvent[] = [
    { type: "system", raw: { type: "system", subtype: "init", model: "Auto", session_id: "s1" } },
    { type: "thinking", raw: { type: "thinking", subtype: "delta", text: "a" } },
    { type: "thinking", raw: { type: "thinking", subtype: "delta", text: "b" } },
    { type: "thinking", raw: { type: "thinking", subtype: "completed" } },
    { type: "tool_call", raw: { type: "tool_call", subtype: "started", call_id: "c1", tool_call: { shellToolCall: { args: { command: "ls" } } } } },
    { type: "tool_call", raw: { type: "tool_call", subtype: "completed", call_id: "c1", tool_call: { shellToolCall: { result: { ok: true } } } } },
    { type: "assistant", raw: { type: "assistant", message: { content: [{ type: "text", text: "Done" }] } } },
    { type: "thinking", raw: { type: "thinking", subtype: "delta", text: "tail" } },
  ];
  const onlyT1 = (md: string) => md.replace(/## T2[\s\S]*/, "");

  it("records the normalized agent timeline with run, task and attempt", async () => {
    const h = harness({ planMd: onlyT1(PLAN_MD), agent: writes(["src/a.ts"]), agentEvents: STREAM });
    await h.run();
    expect(h.agentRecords.map((r) => r.kind)).toEqual(["system", "thinking", "tool_started", "tool_completed", "message", "thinking"]);
    expect(h.agentRecords[1]!.payload).toEqual({ text: "ab" });
    expect(h.agentRecords.at(-1)!.payload).toEqual({ text: "tail" }); // flushed at the end of the attempt
    expect(h.agentRecords.every((r) => r.runId === "run-1" && r.taskId === "T1" && r.attempt === 1)).toBe(true);
    expect(h.agentRecords[0]!.ts).toBe("2026-11-08T10:00:00.000Z");
  });

  it("labels every timeline entry with the name of the agent runner", async () => {
    const h = harness({ planMd: onlyT1(PLAN_MD), agent: writes(["src/a.ts"]), agentEvents: STREAM });
    await h.run();
    expect(h.agentRecords.length).toBeGreaterThan(0);
    expect(h.agentRecords.every((r) => r.agent === "fake-agent")).toBe(true);
  });

  it("writes every raw event to the attempt's transcript and closes it", async () => {
    const h = harness({ planMd: onlyT1(PLAN_MD), agent: writes(["src/a.ts"]), agentEvents: STREAM });
    await h.run();
    expect(h.transcripts).toHaveLength(1);
    expect(h.transcripts[0]!.ctx).toEqual({ runId: "run-1", taskId: "T1", attempt: 1 });
    expect(h.transcripts[0]!.raw).toEqual(STREAM.map((e) => e.raw));
    expect(h.transcripts[0]!.closed).toBe(true);
  });

  it("opens one transcript per attempt", async () => {
    const h = harness({ planMd: onlyT1(PLAN_MD), agent: writes(["src/a.ts"]), check: (c, call) => (c === "npm test" && call === 1 ? { exitCode: 1 } : {}) });
    await h.run();
    expect(h.transcripts.map((t) => t.ctx.attempt)).toEqual([1, 2]);
    expect(h.transcripts.every((t) => t.closed)).toBe(true);
  });

  it("closes the transcript and flushes the timeline even when the agent throws", async () => {
    const h = harness({ planMd: onlyT1(PLAN_MD), agentEvents: STREAM.slice(0, 2), agentThrows: true });
    const summary = await h.run();
    expect(summary.tasks[0]).toMatchObject({ status: "failed" });
    expect(h.transcripts[0]!.closed).toBe(true);
    expect(h.agentRecords.at(-1)).toMatchObject({ kind: "thinking", payload: { text: "a" } });
  });

  it("still works without a transcript store", async () => {
    const summary = await runPlan(plan(), {
      agent: { run: async () => ({ exitCode: 0, isError: false, resultText: "", durationMs: 1, timedOut: false }) },
      checks: { run: async (command) => ({ command, exitCode: 0, output: "", timedOut: false, durationMs: 1 }) },
      workspace: { resolveBase: () => ({ sha: "s", branch: "main" }), prepare: (i) => ({ path: `/w/${i.taskId}`, branch: i.branch, startSha: "s" }), attach: () => undefined, changedPaths: () => ["src/a.ts"], outsideChanges: () => [], inspect: (ws) => ({ branch: ws.branch, historyIntact: true, commits: [{ sha: "x", subject: "feat: w", body: "" }], uncommitted: [] }), push: () => {} },
      store: { createRun() {}, finishRun() {}, reopenRun() {}, getTasks: () => [], nextAttempt: () => 1, upsertTask() {}, recordAttempt() {}, recordEvent() {}, recordAgentEvent() {} },
    }, { runId: "r", planPath: "p", maxAttempts: 1 });
    expect(summary.tasks[0]).toMatchObject({ status: "passed" });
  });
});

describe("runPlan: git verification of the agent's work", () => {
  const retryFlow = (inspection: Partial<GitInspection>) =>
    harness({
      agent: (call, _r, s) => {
        s.changed = [call === 2 ? "src/b.ts" : "src/a.ts"];
        s.inspection = call === 0 ? inspection : {};
      },
    });

  it("fails the attempt on uncommitted changes and asks the agent to commit them", async () => {
    const h = retryFlow({ uncommitted: ["src/a.ts"] });
    const summary = await h.run();
    expect(summary.tasks[0]).toMatchObject({ status: "passed", attempts: 2 });
    expect(h.prompts[1]).toContain("Git problems to fix:\n- Uncommitted changes (commit them): src/a.ts");
    expect(h.checkCalls.filter((c) => c.command === "npm test")).toHaveLength(2); // none on the failed attempt
  });

  it("fails the attempt on an invalid commit message", async () => {
    const h = retryFlow({ commits: [{ sha: "f".repeat(40), subject: "added stuff", body: "" }] });
    await h.run();
    expect(h.prompts[1]).toContain("invalid message 'added stuff'");
  });

  it("fails the attempt on a commit body, a switched branch and rewritten history", async () => {
    const h = retryFlow({
      branch: "main",
      historyIntact: false,
      commits: [{ sha: "a".repeat(40), subject: "feat(core): ok", body: "Co-authored-by: X <x@y.z>" }],
    });
    await h.run();
    expect(h.prompts[1]).toContain("instead of 'feat/first'");
    expect(h.prompts[1]).toContain("History was rewritten");
    expect(h.prompts[1]).toContain("has a body or trailers");
  });

  it("uses the last commit of the branch as the task's commit", async () => {
    const h = harness({ agent: writes(["src/a.ts"], ["src/b.ts"]) });
    h.state.inspection = {
      commits: [
        { sha: "1".repeat(40), subject: "feat(core): one", body: "" },
        { sha: "2".repeat(40), subject: "feat(core): two", body: "" },
      ],
    };
    const summary = await h.run();
    expect(summary.tasks[0]!.commitSha).toBe("2".repeat(40));
  });
});

describe("runPlan: push and pull requests", () => {
  const passing = () => writes(["src/a.ts"], ["src/b.ts"]);

  it("does not push or open PRs by default", async () => {
    const h = harness({ agent: passing() });
    await h.run();
    expect(h.pushed).toEqual([]);
    expect(h.created).toEqual([]);
    expect(h.preflights()).toBe(0);
  });

  it("pushes each passed branch with push", async () => {
    const h = harness({ agent: passing() });
    await h.run({ push: true });
    expect(h.pushed).toEqual(["feat/first", "feat/second"]);
    expect(h.created).toEqual([]);
  });

  it("opens a stacked PR per task with pr: independent targets the base branch, dependent targets its parent", async () => {
    const h = harness({ agent: passing() });
    const summary = await h.run({ pr: true });
    expect(h.preflights()).toBe(1);
    expect(h.pushed).toEqual(["feat/first", "feat/second"]);
    expect(h.created.map((c) => [c.head, c.base, c.title])).toEqual([
      ["feat/first", "main", "feat: First"],
      ["feat/second", "feat/first", "feat: Second"],
    ]);
    expect(h.created[0]!.body).toContain("- S1: first spec");
    expect(summary.tasks.map((t) => t.prUrl)).toEqual(["https://example.test/pull/1", "https://example.test/pull/2"]);
    expect(h.tasks.get("T1")!.prUrl).toBe("https://example.test/pull/1");
    expect(summary.warnings).toEqual([]);
  });

  it("targets the plan base branch for independent tasks", async () => {
    const h = harness({ agent: passing(), planMd: PLAN_MD.replace("Repo: /repo", "Repo: /repo\nBase: develop"), base: { sha: "s", branch: "develop" } });
    await h.run({ pr: true });
    expect(h.created[0]!.base).toBe("develop");
  });

  it("keeps the task passed and warns when the push fails; no PR is attempted for it", async () => {
    const h = harness({ agent: passing(), pushThrows: true });
    const summary = await h.run({ pr: true });
    expect(summary.status).toBe("passed");
    expect(h.created).toEqual([]);
    expect(summary.warnings[0]).toContain("T1: push failed: remote rejected");
    expect(h.events.some((e) => e.type === "push.failed")).toBe(true);
  });

  it("keeps the task passed and warns when the PR cannot be created", async () => {
    const h = harness({ agent: passing(), prThrows: true });
    const summary = await h.run({ pr: true });
    expect(summary.status).toBe("passed");
    expect(summary.warnings[0]).toContain("T1: pull request failed: gh exploded");
    expect(summary.tasks[0]!.prUrl).toBeUndefined();
  });

  it("rejects before creating the run when preflight fails", async () => {
    const failing: PullRequests = { preflight: () => { throw new Error("gh not logged in"); }, create: () => ({ url: "x" }) };
    const run = runPlan(plan(), {
      agent: { run: async () => { throw new Error("must not run"); } },
      checks: { run: async () => { throw new Error("must not run"); } },
      workspace: { ...({} as Workspace), resolveBase: () => ({ sha: "s", branch: "main" }) },
      store: { ...({} as RunStore), createRun: () => { throw new Error("must not create the run"); } },
      pullRequests: failing,
    }, { runId: "r", planPath: "p", pr: true });
    await expect(run).rejects.toThrow("gh not logged in");
  });

  it("rejects pr without a pull request adapter, and pr when the base is not a branch", async () => {
    await expect(harness().run({ pr: true }, false)).rejects.toThrow(/pull request/i);
    await expect(harness({ base: { sha: "s" } }).run({ pr: true })).rejects.toThrow(/Base:/);
  });
});

describe("runPlan: resume", () => {
  const existing: TaskRecord[] = [
    { runId: "run-1", taskId: "T1", title: "First", status: "passed", branch: "feat/first", worktree: "/w/run-1/T1/repo", startSha: "start-T1", commitSha: "c1" },
    { runId: "run-1", taskId: "T2", title: "Second", status: "failed", branch: "feat/second", worktree: "/w/run-1/T2/repo", startSha: "start-T2" },
  ];

  it("reuses passed tasks, re-attaches the failed worktree and continues without setup", async () => {
    const h = harness({ existing, nextAttemptStart: 3, agent: writes(["src/b.ts"]) });
    const summary = await h.run({ resume: true });
    expect(h.runs.created).toBeUndefined();
    expect(h.runs.reopened).toBe(true);
    expect(h.events[0]).toMatchObject({ type: "run.resumed" });
    expect(summary.tasks).toEqual([
      { taskId: "T1", status: "passed", attempts: 0, commitSha: "c1", reused: true },
      { taskId: "T2", status: "passed", attempts: 1, commitSha: "sha-feat/second" },
    ]);
    expect(h.prepared).toEqual([]);
    expect(h.attached).toEqual(["/w/run-1/T2/repo"]);
    expect(h.order).not.toContain("check:pnpm install");
    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]).toContain("A previous run of this task did not finish");
    expect(h.attempts[0]).toMatchObject({ taskId: "T2", attempt: 3 });
  });

  it("records the new pid on resume and snapshots the tasks that are added", async () => {
    const h = harness({ existing: [existing[0]!], agent: writes(["src/b.ts"]) });
    await h.run({ resume: true, pid: 99 });
    expect(h.runs.created).toBeUndefined();
    expect(h.runs.reopenPid).toBe(99);
    expect(h.tasks.get("T2")).toMatchObject({ goal: "Do second.", dependsOn: "T1", position: 2 });
  });

  it("prepares a fresh worktree from the parent's branch when the old one is gone", async () => {
    const h = harness({ existing, attachResult: "gone", agent: writes(["src/b.ts"]) });
    await h.run({ resume: true });
    expect(h.prepared.map((p) => [p.taskId, p.startPoint])).toEqual([["T2", "feat/first"]]);
    expect(h.order).toContain("check:pnpm install");
    expect(h.prompts[0]).not.toContain("A previous run of this task did not finish");
  });

  it("delivers a missing PR for an already passed task when resuming with pr", async () => {
    const h = harness({ existing, agent: writes(["src/b.ts"]) });
    const summary = await h.run({ resume: true, pr: true });
    expect(h.created.map((c) => [c.head, c.base])).toEqual([
      ["feat/first", "main"],
      ["feat/second", "feat/first"],
    ]);
    expect(summary.tasks[0]).toMatchObject({ reused: true, prUrl: "https://example.test/pull/1" });
  });

  it("does not open a second PR for a task that already has one", async () => {
    const withPr = existing.map((t) => (t.taskId === "T1" ? { ...t, prUrl: "https://example.test/pull/99" } : t));
    const h = harness({ existing: withPr, agent: writes(["src/b.ts"]) });
    const summary = await h.run({ resume: true, pr: true });
    expect(h.created.map((c) => c.head)).toEqual(["feat/second"]);
    expect(summary.tasks[0]!.prUrl).toBe("https://example.test/pull/99");
  });
});

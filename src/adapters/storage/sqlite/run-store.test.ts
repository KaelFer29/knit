import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteRunStore } from "./run-store.js";

let store: SqliteRunStore;

const RUN = {
  id: "run-1",
  planName: "demo",
  planPath: "/p/plan.md",
  repo: "/r",
  base: "main@abc12345",
  startedAt: "2026-11-08T10:00:00.000Z",
};

beforeEach(() => {
  store = new SqliteRunStore(":memory:");
  store.createRun(RUN);
});

describe("SqliteRunStore", () => {
  it("creates a running run and finishes it", () => {
    expect(store.getRun("run-1")?.run).toMatchObject({ ...RUN, status: "running" });
    store.finishRun("run-1", "passed", "2026-11-08T10:05:00.000Z");
    expect(store.getRun("run-1")?.run).toMatchObject({ status: "passed", finishedAt: "2026-11-08T10:05:00.000Z" });
  });

  it("returns undefined for an unknown run", () => {
    expect(store.getRun("nope")).toBeUndefined();
  });

  it("upserts tasks without losing fields set earlier", () => {
    store.upsertTask({ runId: "run-1", taskId: "T1", title: "A", status: "running", branch: "orch/run-1/t1", worktree: "/w" });
    store.upsertTask({ runId: "run-1", taskId: "T1", title: "A", status: "passed", commitSha: "deadbeef" });
    expect(store.getRun("run-1")?.tasks).toEqual([
      { runId: "run-1", taskId: "T1", title: "A", status: "passed", branch: "orch/run-1/t1", worktree: "/w", commitSha: "deadbeef" },
    ]);
  });

  it("records attempts with every field and returns them in order", () => {
    const base = { runId: "run-1", taskId: "T1", startedAt: "t", durationMs: 10, exitCode: 0, isError: false, scopeOk: true };
    store.recordAttempt({ ...base, attempt: 1, status: "failed", failedCheck: "npm test", inputTokens: 5, outputTokens: 2, sessionId: "s1", resultText: "r" });
    store.recordAttempt({ ...base, attempt: 2, status: "passed" });
    const attempts = store.getRun("run-1")!.attempts;
    expect(attempts.map((a) => a.attempt)).toEqual([1, 2]);
    expect(attempts[0]).toMatchObject({ failedCheck: "npm test", inputTokens: 5, outputTokens: 2, sessionId: "s1", scopeOk: true, isError: false, status: "failed" });
    expect(attempts[1]!.failedCheck).toBeUndefined();
  });

  it("stores events with JSON payloads and lists them in insertion order", () => {
    store.recordEvent({ runId: "run-1", ts: "t1", type: "run.started" });
    store.recordEvent({ runId: "run-1", taskId: "T1", attempt: 1, ts: "t2", type: "agent.tool_call", payload: { a: 1 } });
    expect(store.getEvents("run-1")).toEqual([
      { runId: "run-1", ts: "t1", type: "run.started" },
      { runId: "run-1", taskId: "T1", attempt: 1, ts: "t2", type: "agent.tool_call", payload: { a: 1 } },
    ]);
  });

  it("lists runs newest first", () => {
    store.createRun({ ...RUN, id: "run-2", startedAt: "2026-11-09T10:00:00.000Z" });
    expect(store.listRuns().map((r) => r.id)).toEqual(["run-2", "run-1"]);
  });

  it("keeps startSha and prUrl across upserts and exposes tasks via getTasks", () => {
    store.upsertTask({ runId: "run-1", taskId: "T1", title: "A", status: "running", startSha: "abc", branch: "feat/a" });
    store.upsertTask({ runId: "run-1", taskId: "T1", title: "A", status: "passed", prUrl: "https://x/pull/1" });
    expect(store.getTasks("run-1")).toEqual([
      { runId: "run-1", taskId: "T1", title: "A", status: "passed", branch: "feat/a", startSha: "abc", prUrl: "https://x/pull/1" },
    ]);
    expect(store.getTasks("nope")).toEqual([]);
  });

  it("reopens a finished run", () => {
    store.finishRun("run-1", "failed", "2026-11-08T10:05:00.000Z");
    store.reopenRun("run-1");
    const run = store.getRun("run-1")!.run;
    expect(run.status).toBe("running");
    expect(run.finishedAt).toBeUndefined();
  });

  it("numbers the next attempt of a task", () => {
    const base = { runId: "run-1", taskId: "T1", startedAt: "t", durationMs: 1, exitCode: 0, isError: false, scopeOk: true, status: "failed" as const };
    expect(store.nextAttempt("run-1", "T1")).toBe(1);
    store.recordAttempt({ ...base, attempt: 1 });
    store.recordAttempt({ ...base, attempt: 2 });
    expect(store.nextAttempt("run-1", "T1")).toBe(3);
    expect(store.nextAttempt("run-1", "T2")).toBe(1);
  });
});

describe("SqliteRunStore agent events", () => {
  const ev = (kind: string, n: number, extra: object = {}) => ({
    runId: "run-1", taskId: "T1", attempt: 1, ts: `t${n}`, kind, payload: { n }, ...extra,
  });

  it("stores agent events and returns them in order with increasing ids", () => {
    store.recordAgentEvent(ev("thinking", 1));
    store.recordAgentEvent(ev("tool_started", 2, { taskId: "T2", attempt: 3 }));
    const all = store.getAgentEvents("run-1");
    expect(all.map((e) => [e.kind, e.taskId, e.attempt, e.payload])).toEqual([
      ["thinking", "T1", 1, { n: 1 }],
      ["tool_started", "T2", 3, { n: 2 }],
    ]);
    expect(all[1]!.id).toBeGreaterThan(all[0]!.id);
  });

  it("supports afterId, task filter and limit for live polling", () => {
    for (let i = 1; i <= 5; i++) store.recordAgentEvent(ev("message", i, { taskId: i % 2 ? "T1" : "T2" }));
    const first = store.getAgentEvents("run-1", { limit: 2 });
    expect(first.map((e) => e.ts)).toEqual(["t1", "t2"]);
    const next = store.getAgentEvents("run-1", { afterId: first.at(-1)!.id });
    expect(next.map((e) => e.ts)).toEqual(["t3", "t4", "t5"]);
    expect(store.getAgentEvents("run-1", { taskId: "T2" }).map((e) => e.ts)).toEqual(["t2", "t4"]);
    expect(store.getAgentEvents("nope")).toEqual([]);
  });
});

describe("SqliteRunStore plan snapshot", () => {
  it("stores the plan text and the pid of the process that runs it", () => {
    store.createRun({ ...RUN, id: "run-2", planText: "# Plan: demo\n", pid: 4242 });
    expect(store.getRun("run-2")?.run).toMatchObject({ planText: "# Plan: demo\n", pid: 4242 });
    expect(store.getRun("run-1")?.run.planText).toBeUndefined();
    expect(store.getRun("run-1")?.run.pid).toBeUndefined();
  });

  it("clears the pid when the run finishes and sets it again when the run is reopened", () => {
    store.createRun({ ...RUN, id: "run-2", pid: 4242 });
    store.finishRun("run-2", "failed", "2026-11-08T11:00:00.000Z");
    expect(store.getRun("run-2")?.run.pid).toBeUndefined();
    store.reopenRun("run-2", 777);
    expect(store.getRun("run-2")?.run).toMatchObject({ status: "running", pid: 777 });
    store.reopenRun("run-2");
    expect(store.getRun("run-2")?.run.pid).toBeUndefined();
  });

  it("stores goal, dependency, position and specs of a task and keeps them across later upserts", () => {
    store.upsertTask({
      runId: "run-1",
      taskId: "T2",
      title: "Second",
      status: "pending",
      goal: "Do second.",
      dependsOn: "T1",
      position: 2,
      specs: [{ id: "S1", text: "second spec" }],
    });
    store.upsertTask({ runId: "run-1", taskId: "T2", title: "Second", status: "running", branch: "feat/second" });
    expect(store.getTasks("run-1")[0]).toEqual({
      runId: "run-1",
      taskId: "T2",
      title: "Second",
      status: "running",
      branch: "feat/second",
      goal: "Do second.",
      dependsOn: "T1",
      position: 2,
      specs: [{ id: "S1", text: "second spec" }],
    });
  });

  it("labels agent events with the agent that produced them and defaults to cursor", () => {
    store.recordAgentEvent({ runId: "run-1", ts: "t", kind: "message", agent: "claude" });
    store.recordAgentEvent({ runId: "run-1", ts: "t", kind: "message" });
    expect(store.getAgentEvents("run-1").map((e) => e.agent)).toEqual(["claude", "cursor"]);
  });
});

describe("SqliteRunStore migration", () => {
  it("adds the plan snapshot columns to a version 3 database without losing data", () => {
    const dir = mkdtempSync(join(tmpdir(), "orq-db-"));
    try {
      const path = join(dir, "v3.db");
      const old = new Database(path);
      old.exec(`
        CREATE TABLE runs (id TEXT PRIMARY KEY, plan_name TEXT NOT NULL, plan_path TEXT NOT NULL, repo TEXT NOT NULL, base TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL);
        CREATE TABLE tasks (run_id TEXT NOT NULL, task_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, branch TEXT, worktree TEXT, commit_sha TEXT, pr_url TEXT, start_sha TEXT, PRIMARY KEY (run_id, task_id));
        CREATE TABLE attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, task_id TEXT NOT NULL, attempt INTEGER NOT NULL, started_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, exit_code INTEGER, is_error INTEGER NOT NULL, input_tokens INTEGER, output_tokens INTEGER, scope_ok INTEGER NOT NULL, failed_check TEXT, status TEXT NOT NULL, session_id TEXT, result_text TEXT);
        CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, task_id TEXT, attempt INTEGER, ts TEXT NOT NULL, type TEXT NOT NULL, payload TEXT);
        CREATE TABLE agent_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, task_id TEXT, attempt INTEGER, ts TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT);
        INSERT INTO runs VALUES ('old-run', 'p', '/p', '/r', 'main@1', 't', NULL, 'running');
        INSERT INTO tasks VALUES ('old-run', 'T1', 'Old', 'passed', 'feat/old', '/w', 'deadbeef', NULL, 'start1');
        INSERT INTO agent_events (run_id, task_id, attempt, ts, kind, payload) VALUES ('old-run', 'T1', 1, 't', 'message', '{"text":"hi"}');
        PRAGMA user_version = 3;
      `);
      old.close();

      const migrated = new SqliteRunStore(path);
      expect(migrated.getRun("old-run")?.run).toEqual({
        id: "old-run", planName: "p", planPath: "/p", repo: "/r", base: "main@1", startedAt: "t", status: "running",
      });
      expect(migrated.getTasks("old-run")).toEqual([
        { runId: "old-run", taskId: "T1", title: "Old", status: "passed", branch: "feat/old", worktree: "/w", commitSha: "deadbeef", startSha: "start1" },
      ]);
      expect(migrated.getAgentEvents("old-run")).toMatchObject([{ kind: "message", agent: "cursor", payload: { text: "hi" } }]);
      migrated.close();

      const raw = new Database(path);
      expect(raw.pragma("user_version", { simple: true })).toBe(5);
      raw.close();
      expect(() => new SqliteRunStore(path).close()).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds the agent events table to a version 2 database", () => {
    const dir = mkdtempSync(join(tmpdir(), "orq-db-"));
    try {
      const path = join(dir, "v2.db");
      const first = new SqliteRunStore(path);
      first.createRun(RUN);
      first.close();
      const raw = new Database(path);
      raw.exec("DROP TABLE agent_events; PRAGMA user_version = 2;");
      raw.close();
      const migrated = new SqliteRunStore(path);
      migrated.recordAgentEvent({ runId: "run-1", ts: "t", kind: "message", payload: { text: "hi" } });
      expect(migrated.getAgentEvents("run-1")).toHaveLength(1);
      expect(migrated.getRun("run-1")?.run.id).toBe("run-1");
      migrated.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("upgrades a version 1 database in place without losing data", () => {
    const dir = mkdtempSync(join(tmpdir(), "orq-db-"));
    try {
      const path = join(dir, "old.db");
      const old = new Database(path);
      old.exec(`
        CREATE TABLE runs (id TEXT PRIMARY KEY, plan_name TEXT NOT NULL, plan_path TEXT NOT NULL, repo TEXT NOT NULL, base TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL);
        CREATE TABLE tasks (run_id TEXT NOT NULL, task_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, branch TEXT, worktree TEXT, commit_sha TEXT, PRIMARY KEY (run_id, task_id));
        INSERT INTO runs VALUES ('old-run', 'p', '/p', '/r', 'main@1', 't', NULL, 'passed');
        INSERT INTO tasks VALUES ('old-run', 'T1', 'Old', 'passed', 'orch/old/t1', '/w', 'deadbeef');
        PRAGMA user_version = 1;
      `);
      old.close();
      const migrated = new SqliteRunStore(path);
      expect(migrated.getTasks("old-run")).toEqual([
        { runId: "old-run", taskId: "T1", title: "Old", status: "passed", branch: "orch/old/t1", worktree: "/w", commitSha: "deadbeef" },
      ]);
      migrated.upsertTask({ runId: "old-run", taskId: "T1", title: "Old", status: "passed", prUrl: "https://x/pull/9" });
      expect(migrated.getTasks("old-run")[0]!.prUrl).toBe("https://x/pull/9");
      migrated.close();
      expect(() => new SqliteRunStore(path).close()).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

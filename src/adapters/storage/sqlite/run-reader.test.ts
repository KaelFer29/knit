import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteRunReader } from "./run-reader.js";
import { SqliteRunStore } from "./run-store.js";

let dir: string;
let dbPath: string;
let store: SqliteRunStore;
let reader: SqliteRunReader | undefined;

const RUN = {
  id: "run-1",
  planName: "demo",
  planPath: "/p/plan.md",
  repo: "/r",
  base: "main@abc12345",
  startedAt: "2026-11-08T10:00:00.000Z",
};
const attempt = (taskId: string, n: number, extra: object = {}) => ({
  runId: "run-1", taskId, attempt: n, startedAt: "2026-11-08T10:01:00.000Z", durationMs: 1000, exitCode: 0,
  isError: false, scopeOk: true, status: "passed" as const, ...extra,
});
const agentEvent = (taskId: string, n: number, kind: string, extra: object = {}) => ({
  runId: "run-1", taskId, attempt: n, ts: "2026-11-08T10:01:01.000Z", kind, ...extra,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "knit-reader-"));
  dbPath = join(dir, "knit.db");
  store = new SqliteRunStore(dbPath);
});

afterEach(() => {
  reader?.close();
  reader = undefined;
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const open = (): SqliteRunReader => (reader = new SqliteRunReader(dbPath));

describe("SqliteRunReader", () => {
  it("refuses to open a database that does not exist, without creating it", () => {
    expect(() => new SqliteRunReader(join(dir, "missing.db"))).toThrow();
    expect(() => readFileSync(join(dir, "missing.db"))).toThrow();
  });

  it("lists runs newest first with task counts and token totals", () => {
    store.createRun(RUN);
    store.upsertTask({ runId: "run-1", taskId: "T1", title: "A", status: "passed" });
    store.upsertTask({ runId: "run-1", taskId: "T2", title: "B", status: "failed" });
    store.upsertTask({ runId: "run-1", taskId: "T3", title: "C", status: "pending" });
    store.recordAttempt(attempt("T1", 1, { inputTokens: 100, outputTokens: 10 }));
    store.recordAttempt(attempt("T2", 1, { inputTokens: 50, outputTokens: 5, status: "failed" }));
    store.recordAttempt(attempt("T2", 2));
    store.finishRun("run-1", "failed", "2026-11-08T10:05:00.000Z");
    store.createRun({ ...RUN, id: "run-2", startedAt: "2026-11-08T11:00:00.000Z", pid: 42 });
    store.upsertTask({ runId: "run-2", taskId: "T1", title: "D", status: "running" });

    const list = open().listRuns();

    expect(list.map((r) => r.run.id)).toEqual(["run-2", "run-1"]);
    expect(list[0]).toMatchObject({
      run: { status: "running", pid: 42 },
      taskCounts: { total: 1, pending: 0, running: 1, passed: 0, failed: 0 },
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(list[1]).toMatchObject({
      run: { status: "failed", finishedAt: "2026-11-08T10:05:00.000Z" },
      taskCounts: { total: 3, pending: 1, running: 0, passed: 1, failed: 1 },
      inputTokens: 150,
      outputTokens: 15,
    });
  });

  it("returns an empty list for a database without runs", () => {
    expect(open().listRuns()).toEqual([]);
  });

  it("returns a snapshot with run, tasks, attempts, events and resume points", () => {
    store.createRun({ ...RUN, planText: "# plan" });
    store.upsertTask({ runId: "run-1", taskId: "T1", title: "A", status: "running", goal: "do it", position: 1, specs: [{ id: "S1", text: "x" }] });
    store.recordAttempt(attempt("T1", 1, { failedCheck: "npm test", status: "failed" }));
    store.recordEvent({ runId: "run-1", ts: "t1", type: "run.started", payload: { tasks: 1 } });
    store.recordEvent({ runId: "run-1", taskId: "T1", attempt: 1, ts: "t2", type: "attempt.started" });
    store.recordAgentEvent(agentEvent("T1", 1, "message", { payload: { text: "hi" } }));

    const snap = open().getRunSnapshot("run-1")!;

    expect(snap.run).toMatchObject({ id: "run-1", status: "running", planText: "# plan" });
    expect(snap.tasks).toEqual([
      expect.objectContaining({ taskId: "T1", goal: "do it", position: 1, specs: [{ id: "S1", text: "x" }] }),
    ]);
    expect(snap.attempts).toEqual([expect.objectContaining({ attempt: 1, status: "failed", failedCheck: "npm test" })]);
    expect(snap.events).toEqual([
      { id: 1, runId: "run-1", ts: "t1", type: "run.started", payload: { tasks: 1 } },
      { id: 2, runId: "run-1", taskId: "T1", attempt: 1, ts: "t2", type: "attempt.started" },
    ]);
    expect(snap.lastEventId).toBe(2);
    expect(snap.lastAgentEventId).toBe(1);
  });

  it("returns undefined for an unknown run and zero resume points for a run without events", () => {
    store.createRun(RUN);
    expect(open().getRunSnapshot("nope")).toBeUndefined();
    expect(reader!.getRunSnapshot("run-1")).toMatchObject({ lastEventId: 0, lastAgentEventId: 0, events: [] });
  });

  it("resumes lifecycle events after an id with no gaps or duplicates", () => {
    store.createRun(RUN);
    for (let i = 1; i <= 5; i++) store.recordEvent({ runId: "run-1", ts: `t${i}`, type: `e${i}` });
    store.createRun({ ...RUN, id: "run-2" });
    store.recordEvent({ runId: "run-2", ts: "x", type: "other" });
    const r = open();

    const first = r.getEventsAfter("run-1", 0, 2);
    expect(first.map((e) => e.type)).toEqual(["e1", "e2"]);
    const rest = r.getEventsAfter("run-1", first.at(-1)!.id);
    expect(rest.map((e) => e.type)).toEqual(["e3", "e4", "e5"]);
    expect(r.getEventsAfter("run-1", rest.at(-1)!.id)).toEqual([]);
  });

  it("resumes agent events after an id, filtered by task and attempt", () => {
    store.createRun(RUN);
    store.recordAgentEvent(agentEvent("T1", 1, "prompt"));
    store.recordAgentEvent(agentEvent("T2", 1, "prompt", { agent: "claude" }));
    store.recordAgentEvent(agentEvent("T1", 1, "message"));
    store.recordAgentEvent(agentEvent("T1", 2, "message", { payload: { text: "retry" } }));
    const r = open();

    const all = r.getAgentEventsAfter("run-1", 0);
    expect(all.map((e) => [e.id, e.taskId, e.attempt, e.kind, e.agent])).toEqual([
      [1, "T1", 1, "prompt", "cursor"],
      [2, "T2", 1, "prompt", "claude"],
      [3, "T1", 1, "message", "cursor"],
      [4, "T1", 2, "message", "cursor"],
    ]);
    expect(r.getAgentEventsAfter("run-1", 1, { taskId: "T1" }).map((e) => e.id)).toEqual([3, 4]);
    expect(r.getAgentEventsAfter("run-1", 0, { taskId: "T1", attempt: 2 })).toEqual([
      expect.objectContaining({ id: 4, payload: { text: "retry" } }),
    ]);
    expect(r.getAgentEventsAfter("run-1", 0, { limit: 2 }).map((e) => e.id)).toEqual([1, 2]);
    expect(r.getAgentEventsAfter("run-1", 4)).toEqual([]);
  });

  it("reads one run alone, undefined when unknown", () => {
    store.createRun(RUN);
    store.finishRun("run-1", "passed", "2026-11-08T10:05:00.000Z");
    expect(open().getRun("run-1")).toMatchObject({ id: "run-1", status: "passed", finishedAt: "2026-11-08T10:05:00.000Z" });
    expect(reader!.getRun("nope")).toBeUndefined();
  });

  it("returns the latest agent events, oldest first, optionally for one attempt", () => {
    store.createRun(RUN);
    store.recordAgentEvent(agentEvent("T1", 1, "a"));
    store.recordAgentEvent(agentEvent("T2", 1, "b"));
    store.recordAgentEvent(agentEvent("T1", 1, "c"));
    store.recordAgentEvent(agentEvent("T1", 2, "d"));
    store.recordAgentEvent(agentEvent("T1", 1, "e"));
    const r = open();

    expect(r.getLatestAgentEvents("run-1", 2).map((e) => e.kind)).toEqual(["d", "e"]);
    expect(r.getLatestAgentEvents("run-1", 10, { taskId: "T1", attempt: 1 }).map((e) => e.kind)).toEqual(["a", "c", "e"]);
    expect(r.getLatestAgentEvents("run-1", 2, { taskId: "T1", attempt: 1 }).map((e) => [e.id, e.agent])).toEqual([
      [3, "cursor"],
      [5, "cursor"],
    ]);
    expect(r.getLatestAgentEvents("nope", 3)).toEqual([]);
  });

  it("sees rows written by the store after the reader was opened", () => {
    store.createRun(RUN);
    store.recordAgentEvent(agentEvent("T1", 1, "prompt"));
    const r = open();
    expect(r.getAgentEventsAfter("run-1", 0)).toHaveLength(1);

    store.recordAgentEvent(agentEvent("T1", 1, "message"));
    store.recordEvent({ runId: "run-1", ts: "t", type: "attempt.started" });
    store.upsertTask({ runId: "run-1", taskId: "T1", title: "A", status: "running" });
    store.finishRun("run-1", "passed", "2026-11-08T10:05:00.000Z");

    expect(r.getAgentEventsAfter("run-1", 1).map((e) => e.kind)).toEqual(["message"]);
    expect(r.getEventsAfter("run-1", 0)).toHaveLength(1);
    expect(r.getRunSnapshot("run-1")).toMatchObject({ run: { status: "passed" }, tasks: [{ taskId: "T1" }] });
  });

  it("reads while a transaction of the writer is open and sees it once committed", () => {
    store.createRun(RUN);
    const writer = new Database(dbPath);
    const r = open();
    writer.exec("BEGIN IMMEDIATE");
    writer.prepare(`INSERT INTO events (run_id, ts, type) VALUES ('run-1', 't', 'pending-write')`).run();

    expect(r.getEventsAfter("run-1", 0)).toEqual([]);
    writer.exec("COMMIT");
    expect(r.getEventsAfter("run-1", 0).map((e) => e.type)).toEqual(["pending-write"]);
    writer.close();
  });

  it("does not fail on a payload that is not valid JSON", () => {
    store.createRun(RUN);
    const writer = new Database(dbPath);
    writer.prepare(`INSERT INTO events (run_id, ts, type, payload) VALUES ('run-1', 't', 'odd', '{broken')`).run();
    writer.close();

    expect(open().getEventsAfter("run-1", 0)).toEqual([expect.objectContaining({ type: "odd" })]);
  });

  describe("on a database created before schema 4", () => {
    let v3Path: string;

    const createV3 = (): void => {
      const db = new Database(v3Path);
      db.pragma("journal_mode = WAL");
      db.exec(`
        CREATE TABLE runs (id TEXT PRIMARY KEY, plan_name TEXT NOT NULL, plan_path TEXT NOT NULL, repo TEXT NOT NULL,
          base TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL);
        CREATE TABLE tasks (run_id TEXT NOT NULL, task_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
          branch TEXT, worktree TEXT, commit_sha TEXT, pr_url TEXT, start_sha TEXT, PRIMARY KEY (run_id, task_id));
        CREATE TABLE attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, task_id TEXT NOT NULL,
          attempt INTEGER NOT NULL, started_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, exit_code INTEGER,
          is_error INTEGER NOT NULL, input_tokens INTEGER, output_tokens INTEGER, scope_ok INTEGER NOT NULL,
          failed_check TEXT, status TEXT NOT NULL, session_id TEXT, result_text TEXT);
        CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, task_id TEXT, attempt INTEGER,
          ts TEXT NOT NULL, type TEXT NOT NULL, payload TEXT);
        CREATE TABLE agent_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, task_id TEXT,
          attempt INTEGER, ts TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT);
        INSERT INTO runs VALUES ('old', 'legacy', '/p', '/r', 'main@1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:05:00.000Z', 'passed');
        INSERT INTO tasks (run_id, task_id, title, status, commit_sha) VALUES ('old', 'T1', 'Old task', 'passed', 'abc');
        INSERT INTO attempts (run_id, task_id, attempt, started_at, duration_ms, exit_code, is_error, input_tokens,
          output_tokens, scope_ok, status) VALUES ('old', 'T1', 1, '2026-01-01T00:01:00.000Z', 900, 0, 0, 7, 3, 1, 'passed');
        INSERT INTO events (run_id, ts, type) VALUES ('old', 't', 'run.started');
        INSERT INTO agent_events (run_id, task_id, attempt, ts, kind, payload) VALUES ('old', 'T1', 1, 't', 'message', '{"text":"hi"}');
        PRAGMA user_version = 3;
      `);
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.close();
    };
    const hash = (): string => createHash("sha256").update(readFileSync(v3Path)).digest("hex");

    beforeEach(() => {
      v3Path = join(dir, "v3.db");
      createV3();
    });

    it("reads it, leaving the new fields absent", () => {
      const r = new SqliteRunReader(v3Path);
      try {
        const [item] = r.listRuns();
        expect(item).toMatchObject({ run: { id: "old", status: "passed" }, inputTokens: 7, outputTokens: 3 });
        expect(item!.run.planText).toBeUndefined();
        expect(item!.run.pid).toBeUndefined();

        const snap = r.getRunSnapshot("old")!;
        expect(snap.tasks).toEqual([{ runId: "old", taskId: "T1", title: "Old task", status: "passed", commitSha: "abc" }]);
        expect(snap.attempts).toHaveLength(1);
        expect(snap.events).toHaveLength(1);
        expect(r.getAgentEventsAfter("old", 0)).toEqual([
          expect.objectContaining({ id: 1, kind: "message", agent: "cursor", payload: { text: "hi" } }),
        ]);
      } finally {
        r.close();
      }
    });

    it("never migrates it: version, columns and file bytes stay as they were", () => {
      const before = hash();
      const r = new SqliteRunReader(v3Path);
      r.listRuns();
      r.getRunSnapshot("old");
      r.getAgentEventsAfter("old", 0);
      r.close();

      expect(hash()).toBe(before);
      const check = new Database(v3Path, { readonly: true });
      expect(check.pragma("user_version", { simple: true })).toBe(3);
      const columns = (check.pragma("table_info(tasks)") as { name: string }[]).map((c) => c.name);
      expect(columns).not.toContain("goal");
      check.close();
    });
  });
});

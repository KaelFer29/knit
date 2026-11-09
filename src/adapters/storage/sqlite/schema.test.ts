import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteRunStore } from "./run-store.js";
import { SCHEMA_VERSION } from "./schema.js";
import { SqliteSessionStore } from "./session-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");

/** The schema exactly as the version 4 code created it (the plan snapshot, run pid and agent label are in). */
const V4_SCHEMA = `
CREATE TABLE runs (id TEXT PRIMARY KEY, plan_name TEXT NOT NULL, plan_path TEXT NOT NULL, repo TEXT NOT NULL, base TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, plan_text TEXT, pid INTEGER);
CREATE TABLE tasks (run_id TEXT NOT NULL REFERENCES runs(id), task_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, branch TEXT, worktree TEXT, commit_sha TEXT, pr_url TEXT, start_sha TEXT, goal TEXT, depends_on TEXT, position INTEGER, specs TEXT, PRIMARY KEY (run_id, task_id));
CREATE TABLE attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id), task_id TEXT NOT NULL, attempt INTEGER NOT NULL, started_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, exit_code INTEGER, is_error INTEGER NOT NULL, input_tokens INTEGER, output_tokens INTEGER, scope_ok INTEGER NOT NULL, failed_check TEXT, status TEXT NOT NULL, session_id TEXT, result_text TEXT);
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id), task_id TEXT, attempt INTEGER, ts TEXT NOT NULL, type TEXT NOT NULL, payload TEXT);
CREATE TABLE agent_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id), task_id TEXT, attempt INTEGER, ts TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT, agent TEXT NOT NULL DEFAULT 'cursor');
CREATE INDEX idx_agent_events_run ON agent_events(run_id, id);
CREATE INDEX idx_attempts_run ON attempts(run_id, task_id, attempt);
CREATE INDEX idx_events_run ON events(run_id, id);
INSERT INTO runs VALUES ('run-a', 'plan a', '/p/a.md', '/repo', 'main@abc', '2026-11-01T10:00:00.000Z', '2026-11-01T10:05:00.000Z', 'passed', '# Plan: a', NULL);
INSERT INTO runs VALUES ('run-b', 'plan b', '/p/b.md', '/repo', 'main@def', '2026-11-02T10:00:00.000Z', NULL, 'running', NULL, 31337);
INSERT INTO tasks VALUES ('run-a', 'T1', 'First', 'passed', 'feat/a', '/w/a', 'c0ffee', 'https://x/pull/1', 's1', 'Do it', NULL, 1, '[{"id":"S1","text":"x"}]');
INSERT INTO tasks VALUES ('run-b', 'T1', 'Second', 'running', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO attempts (run_id, task_id, attempt, started_at, duration_ms, exit_code, is_error, input_tokens, output_tokens, scope_ok, failed_check, status, session_id, result_text) VALUES ('run-a', 'T1', 1, 't', 1200, 0, 0, 10, 5, 1, NULL, 'passed', 's', 'done');
INSERT INTO attempts (run_id, task_id, attempt, started_at, duration_ms, exit_code, is_error, input_tokens, output_tokens, scope_ok, failed_check, status, session_id, result_text) VALUES ('run-b', 'T1', 1, 't', 90, NULL, 1, NULL, NULL, 0, 'lint', 'failed', NULL, NULL);
INSERT INTO events (run_id, task_id, attempt, ts, type, payload) VALUES ('run-a', 'T1', 1, 't', 'attempt.started', '{"a":1}');
INSERT INTO agent_events (run_id, task_id, attempt, ts, kind, payload, agent) VALUES ('run-a', 'T1', 1, 't', 'message', '{"text":"hi"}', 'cursor');
INSERT INTO agent_events (run_id, task_id, attempt, ts, kind, payload, agent) VALUES ('run-a', 'T1', 1, 't2', 'result', NULL, 'claude');
PRAGMA user_version = 4;
`;

const OLD_TABLES = ["runs", "tasks", "attempts", "events", "agent_events"];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "orq-schema-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeV4(name: string): string {
  const path = join(dir, name);
  const db = new Database(path);
  db.pragma("journal_mode = WAL"); // the version 4 store always switched its file to WAL
  db.exec(V4_SCHEMA);
  db.close();
  return path;
}

/** Everything stored in the old tables plus the DDL that created them, to compare before and after. */
function snapshotOldTables(path: string): { rows: Record<string, unknown[]>; ddl: Record<string, string> } {
  const db = new Database(path, { readonly: true });
  try {
    const rows: Record<string, unknown[]> = {};
    const ddl: Record<string, string> = {};
    for (const table of OLD_TABLES) {
      rows[table] = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
      ddl[table] = (db.prepare(`SELECT sql FROM sqlite_master WHERE name = ?`).get(table) as { sql: string }).sql;
    }
    return { rows, ddl };
  } finally {
    db.close();
  }
}

/** Tables, their columns and the named indexes: the shape that must not depend on which store opened first. */
function shapeOf(path: string): unknown {
  const db = new Database(path, { readonly: true });
  try {
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[]).map(
      (t) => ({
        table: t.name,
        columns: (db.pragma(`table_info(${t.name})`) as { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }[])
          .map(({ name, type, notnull, dflt_value, pk }) => ({ name, type, notnull, dflt_value, pk }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }),
    );
    const indexes = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[]).map((i) => i.name);
    return { tables, indexes, version: db.pragma("user_version", { simple: true }) };
  } finally {
    db.close();
  }
}

describe("schema version 5", () => {
  it("is the current version", () => {
    expect(SCHEMA_VERSION).toBe(5);
  });

  for (const [label, open] of [
    ["SqliteRunStore", (p: string) => new SqliteRunStore(p)],
    ["SqliteSessionStore", (p: string) => new SqliteSessionStore(p)],
  ] as const) {
    it(`${label} upgrades a version 4 database in place and keeps every existing row and table definition`, () => {
      const path = writeV4("v4.db");
      const before = snapshotOldTables(path);
      open(path).close();
      const after = snapshotOldTables(path);
      expect(after.rows).toEqual(before.rows);
      expect(after.ddl).toEqual(before.ddl);
      const names = (shapeOf(path) as { tables: { table: string }[] }).tables.map((t) => t.table);
      expect(names).toEqual(expect.arrayContaining(["sessions", "turns", "session_events"]));
      expect((shapeOf(path) as { version: number }).version).toBe(5);
    });
  }

  it("leaves `agent_events` alone: its run_id stays NOT NULL and session timelines live in `session_events`", () => {
    const path = writeV4("v4.db");
    new SqliteSessionStore(path).close();
    const db = new Database(path, { readonly: true });
    const cols = db.pragma("table_info(agent_events)") as { name: string; notnull: number }[];
    db.close();
    expect(cols.find((c) => c.name === "run_id")?.notnull).toBe(1);
    expect(cols.map((c) => c.name)).not.toContain("session_id");
  });

  it("keeps the migrated runs readable through the run store and lets sessions be stored beside them", () => {
    const path = writeV4("v4.db");
    const runs = new SqliteRunStore(path);
    expect(runs.getRun("run-b")?.run).toMatchObject({ id: "run-b", status: "running", pid: 31337 });
    expect(runs.getAgentEvents("run-a").map((e) => e.agent)).toEqual(["cursor", "claude"]);
    runs.close();
    const sessions = new SqliteSessionStore(path);
    sessions.createSession({ id: "s", agent: "claude", title: "t", cwd: "/r", createdAt: "t" });
    expect(sessions.listSessions()).toHaveLength(1);
    sessions.close();
  });

  it("is idempotent: reopening changes neither the data nor the schema", () => {
    const path = writeV4("v4.db");
    new SqliteSessionStore(path).close();
    const shape = shapeOf(path);
    const data = snapshotOldTables(path);
    new SqliteRunStore(path).close();
    new SqliteSessionStore(path).close();
    expect(shapeOf(path)).toEqual(shape);
    expect(snapshotOldTables(path)).toEqual(data);
  });

  it("gives a new database the same schema whichever store opens it first, and the same as an upgraded one", () => {
    new SqliteRunStore(join(dir, "runs-first.db")).close();
    new SqliteSessionStore(join(dir, "sessions-first.db")).close();
    const upgraded = writeV4("upgraded.db");
    new SqliteSessionStore(upgraded).close();
    expect(shapeOf(join(dir, "sessions-first.db"))).toEqual(shapeOf(join(dir, "runs-first.db")));
    expect(shapeOf(upgraded)).toEqual(shapeOf(join(dir, "runs-first.db")));
  });

  it("repairs a database whose upgrade was interrupted after the version was raised", () => {
    const path = writeV4("v4.db");
    new SqliteSessionStore(path).close();
    const db = new Database(path);
    db.exec("DROP TABLE session_events; DROP TABLE turns; PRAGMA user_version = 5;");
    db.close();
    const store = new SqliteSessionStore(path);
    store.createSession({ id: "s", agent: "claude", title: "t", cwd: "/r", createdAt: "t" });
    expect(store.startTurn({ sessionId: "s", prompt: "p", startedAt: "t" }).seq).toBe(1);
    store.close();
  });
});

/**
 * Several processes opening the same database at the same moment must all succeed. The schema module is
 * compiled on its own with the project's `tsc` (it imports nothing local) and each child loads that build;
 * the children cannot load the TypeScript source directly on Node 20.
 */
describe("opening a database from several processes at once", () => {
  const run = promisify(execFile);
  const PROCESSES = 6;
  const ROUNDS = 4;
  let schemaJs: string;

  beforeEach(() => {
    const build = join(dir, "build");
    mkdirSync(build);
    writeFileSync(join(build, "package.json"), '{"type":"module"}');
    symlinkSync(join(repoRoot, "node_modules"), join(build, "node_modules"));
    execFileSync(
      join(repoRoot, "node_modules/.bin/tsc"),
      [
        join(here, "schema.ts"), "--outDir", join(build, "out"), "--rootDir", here, "--module", "nodenext",
        "--moduleResolution", "nodenext", "--target", "ES2022", "--esModuleInterop", "--skipLibCheck", "--strict",
        "--ignoreConfig",
      ],
      { cwd: repoRoot, stdio: "pipe" },
    );
    schemaJs = join(build, "out/schema.js");
  });

  const child = `
    const [schema, db, startAt] = process.argv.slice(1);
    const { openDatabase } = await import(schema);
    while (Date.now() < Number(startAt)) {}
    openDatabase(db).close();
  `;

  /** Starts every process at the same instant and returns the stderr of each one that failed. */
  async function openTogether(path: string): Promise<string[]> {
    const startAt = String(Date.now() + 700);
    const results = await Promise.allSettled(
      Array.from({ length: PROCESSES }, () => run(process.execPath, ["--input-type=module", "-e", child, schemaJs, path, startAt])),
    );
    return results.flatMap((r) => (r.status === "rejected" ? [String((r.reason as { stderr?: string }).stderr ?? r.reason)] : []));
  }

  it("upgrades an old database without a failure and without touching its rows", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const path = writeV4(`old-${round}.db`);
      const before = snapshotOldTables(path);
      expect(await openTogether(path)).toEqual([]);
      expect(snapshotOldTables(path)).toEqual(before);
      expect((shapeOf(path) as { version: number }).version).toBe(5);
    }
  }, 60_000);

  it("creates a new database without a failure and with the same schema as a single opener", async () => {
    new SqliteRunStore(join(dir, "single.db")).close();
    for (let round = 0; round < ROUNDS; round++) {
      const path = join(dir, `new-${round}.db`);
      expect(await openTogether(path)).toEqual([]);
      expect(shapeOf(path)).toEqual(shapeOf(join(dir, "single.db")));
    }
  }, 60_000);
});

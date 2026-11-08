import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteSessionReader } from "./session-reader.js";
import { SqliteSessionStore } from "./session-store.js";

let dir: string;
let path: string;
let store: SqliteSessionStore;
let reader: SqliteSessionReader | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "orq-session-reader-"));
  path = join(dir, "knit.db");
  store = new SqliteSessionStore(path);
});
afterEach(() => {
  reader?.close();
  reader = undefined;
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function seed(): void {
  store.createSession({ id: "a", agent: "claude", title: "Plan", cwd: "/repo", createdAt: "2026-11-08T10:00:00.000Z" });
  store.createSession({ id: "b", agent: "cursor", title: "Fix", cwd: "/repo", createdAt: "2026-11-08T11:00:00.000Z" });
  const t1 = store.startTurn({ sessionId: "a", prompt: "one", startedAt: "2026-11-08T12:00:00.000Z", profile: { model: "opus" } });
  store.recordEvent({ sessionId: "a", turnId: t1.id, ts: "t", kind: "message", payload: { text: "hi" }, agent: "claude" });
  store.recordEvent({ sessionId: "a", turnId: t1.id, ts: "t", kind: "result", payload: { text: "done" }, agent: "claude" });
  store.finishTurn(t1.id, {
    status: "passed",
    finishedAt: "2026-11-08T12:01:00.000Z",
    inputTokens: 10,
    outputTokens: 5,
    exitCode: 0,
    meta: { commands: ["compact"], planUsage: [{ name: "five_hour", utilization: 0.4 }] },
  });
  const t2 = store.startTurn({ sessionId: "a", prompt: "two", startedAt: "2026-11-08T12:02:00.000Z" });
  store.finishTurn(t2.id, { status: "passed", finishedAt: "2026-11-08T12:03:00.000Z", inputTokens: 1, outputTokens: 2, exitCode: 0 });
}

describe("SqliteSessionReader", () => {
  it("refuses to open a database that does not exist, without creating it", () => {
    const missing = join(dir, "missing.db");
    expect(() => new SqliteSessionReader(missing)).toThrow();
    expect(existsSync(missing)).toBe(false);
  });

  it("lists sessions most recent first with turn counts and token totals", () => {
    seed();
    reader = new SqliteSessionReader(path);
    const list = reader.listSessions();
    expect(list.map((i) => i.session.id)).toEqual(["a", "b"]);
    expect(list[0]).toMatchObject({ turnCount: 2, inputTokens: 11, outputTokens: 7 });
    expect(list[1]).toMatchObject({ turnCount: 0, inputTokens: 0, outputTokens: 0 });
  });

  it("returns a session and its turns with profile and meta", () => {
    seed();
    reader = new SqliteSessionReader(path);
    expect(reader.getSession("a")).toMatchObject({ id: "a", agent: "claude", status: "idle" });
    expect(reader.getSession("nope")).toBeUndefined();
    const turns = reader.listTurns("a");
    expect(turns.map((t) => t.seq)).toEqual([1, 2]);
    expect(turns[0]).toMatchObject({ profile: { model: "opus" }, meta: { commands: ["compact"] } });
    expect(reader.listTurns("nope")).toEqual([]);
  });

  it("resumes events after an id with no gaps or duplicates", () => {
    seed();
    reader = new SqliteSessionReader(path);
    const all = reader.getEvents("a");
    expect(all.map((e) => e.kind)).toEqual(["message", "result"]);
    expect(reader.getEvents("a", { afterId: all[0]!.id }).map((e) => e.kind)).toEqual(["result"]);
    expect(reader.getEvents("a", { afterId: all[1]!.id })).toEqual([]);
    expect(reader.getEvents("a", { turnId: 999 })).toEqual([]);
  });

  it("sees rows written after it was opened", () => {
    seed();
    reader = new SqliteSessionReader(path);
    expect(reader.listSessions()).toHaveLength(2);
    store.createSession({ id: "c", agent: "claude", title: "New", cwd: "/repo", createdAt: "2026-11-08T13:00:00.000Z" });
    expect(reader.listSessions()).toHaveLength(3);
  });

  it("treats a database without session tables as having no sessions and never migrates it", () => {
    const old = join(dir, "old.db");
    const db = new Database(old);
    db.exec(`CREATE TABLE runs (id TEXT)`);
    db.pragma("user_version = 3");
    db.close();
    const before = readFileSync(old);
    reader = new SqliteSessionReader(old);
    expect(reader.listSessions()).toEqual([]);
    expect(reader.getSession("a")).toBeUndefined();
    expect(reader.listTurns("a")).toEqual([]);
    expect(reader.getEvents("a")).toEqual([]);
    reader.close();
    reader = undefined;
    expect(readFileSync(old).equals(before)).toBe(true);
  });
});

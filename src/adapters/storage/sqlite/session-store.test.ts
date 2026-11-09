import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NewSession } from "../../../core/ports/session-store.js";
import { SqliteSessionStore } from "./session-store.js";

const SESSION: NewSession = { id: "chat-1", agent: "claude", title: "Plan the board", cwd: "/repo", createdAt: "2026-11-08T10:00:00.000Z" };

let dir: string;
let store: SqliteSessionStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "orq-sessions-"));
  store = new SqliteSessionStore(join(dir, "knit.db"));
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("SqliteSessionStore sessions", () => {
  it("creates an idle session without an agent session id and finds it", () => {
    store.createSession(SESSION);
    expect(store.getSession("chat-1")).toEqual({ ...SESSION, updatedAt: SESSION.createdAt, status: "idle" });
  });

  it("returns undefined for an unknown session", () => {
    expect(store.getSession("nope")).toBeUndefined();
  });

  it("remembers the agent's own session id and bumps updatedAt", () => {
    store.createSession(SESSION);
    store.setAgentSessionId("chat-1", "agent-xyz", "2026-11-08T10:05:00.000Z");
    expect(store.getSession("chat-1")).toMatchObject({ agentSessionId: "agent-xyz", updatedAt: "2026-11-08T10:05:00.000Z" });
  });

  it("lists sessions of every agent, most recently active first", () => {
    store.createSession({ ...SESSION, id: "a", createdAt: "2026-11-08T10:00:00.000Z" });
    store.createSession({ ...SESSION, id: "b", agent: "cursor", createdAt: "2026-11-08T11:00:00.000Z" });
    store.createSession({ ...SESSION, id: "c", createdAt: "2026-11-08T12:00:00.000Z" });
    expect(store.listSessions().map((s) => s.id)).toEqual(["c", "b", "a"]);
    store.startTurn({ sessionId: "a", prompt: "later", startedAt: "2026-11-08T13:00:00.000Z" });
    expect(store.listSessions().map((s) => s.id)).toEqual(["a", "c", "b"]);
  });

  it("rejects a duplicate session id", () => {
    store.createSession(SESSION);
    expect(() => store.createSession(SESSION)).toThrow();
  });
});

describe("SqliteSessionStore turns", () => {
  beforeEach(() => store.createSession(SESSION));

  it("numbers turns per session, records the pid and marks the session running", () => {
    store.createSession({ ...SESSION, id: "chat-2" });
    const first = store.startTurn({ sessionId: "chat-1", prompt: "one", startedAt: "t1", pid: 4242 });
    const second = store.startTurn({ sessionId: "chat-1", prompt: "two", startedAt: "t2" });
    const other = store.startTurn({ sessionId: "chat-2", prompt: "x", startedAt: "t3" });
    expect([first.seq, second.seq, other.seq]).toEqual([1, 2, 1]);
    expect(new Set([first.id, second.id, other.id]).size).toBe(3);
    expect(first).toEqual({ id: first.id, sessionId: "chat-1", seq: 1, prompt: "one", startedAt: "t1", status: "running", pid: 4242 });
    expect(store.getSession("chat-1")).toMatchObject({ status: "running", updatedAt: "t2" });
  });

  it("stores the profile given when the turn starts", () => {
    store.startTurn({ sessionId: "chat-1", prompt: "p", startedAt: "t", profile: { model: "opus", effort: "high" } });
    expect(store.listTurns("chat-1")[0]!.profile).toEqual({ model: "opus", effort: "high" });
  });

  it("finishes a turn with its outcome, clears the pid and returns the session to idle", () => {
    const turn = store.startTurn({ sessionId: "chat-1", prompt: "p", startedAt: "t1", pid: 7 });
    const meta = { commands: ["usage", "clear"], planUsage: [{ name: "five_hour", utilization: 0.4, resetsAt: 1780000000 }], model: "m" };
    store.finishTurn(turn.id, {
      status: "passed", finishedAt: "t2", resultText: "the answer", inputTokens: 100, outputTokens: 20, exitCode: 0, meta,
    });
    expect(store.listTurns("chat-1")).toEqual([
      {
        id: turn.id, sessionId: "chat-1", seq: 1, prompt: "p", startedAt: "t1", finishedAt: "t2", status: "passed",
        resultText: "the answer", inputTokens: 100, outputTokens: 20, exitCode: 0, meta,
      },
    ]);
    expect(store.getSession("chat-1")).toMatchObject({ status: "idle", updatedAt: "t2" });
  });

  it("records a failed turn that left no exit code", () => {
    const turn = store.startTurn({ sessionId: "chat-1", prompt: "p", startedAt: "t1", pid: 7 });
    store.finishTurn(turn.id, { status: "failed", finishedAt: "t2", resultText: "timed out", exitCode: null });
    const [stored] = store.listTurns("chat-1");
    expect(stored).toMatchObject({ status: "failed", resultText: "timed out" });
    expect(stored).not.toHaveProperty("exitCode");
    expect(stored).not.toHaveProperty("pid");
  });

  it("lists turns oldest first and none for an unknown session", () => {
    store.startTurn({ sessionId: "chat-1", prompt: "one", startedAt: "t1" });
    store.startTurn({ sessionId: "chat-1", prompt: "two", startedAt: "t2" });
    expect(store.listTurns("chat-1").map((t) => t.prompt)).toEqual(["one", "two"]);
    expect(store.listTurns("nope")).toEqual([]);
  });

  it("refuses a turn for an unknown session", () => {
    expect(() => store.startTurn({ sessionId: "nope", prompt: "p", startedAt: "t" })).toThrow();
  });
});

describe("SqliteSessionStore events", () => {
  let turnId: number;
  let otherTurnId: number;
  beforeEach(() => {
    store.createSession(SESSION);
    turnId = store.startTurn({ sessionId: "chat-1", prompt: "one", startedAt: "t1" }).id;
    store.finishTurn(turnId, { status: "passed", finishedAt: "t2" });
    otherTurnId = store.startTurn({ sessionId: "chat-1", prompt: "two", startedAt: "t3" }).id;
  });

  it("stores events with their agent and JSON payload, in order, with increasing ids", () => {
    store.recordEvent({ sessionId: "chat-1", turnId, ts: "2026-11-08T10:00:01.000Z", kind: "message", payload: { text: "hi" }, agent: "claude" });
    store.recordEvent({ sessionId: "chat-1", turnId, ts: "2026-11-08T10:00:02.000Z", kind: "result", agent: "claude" });
    const events = store.getEvents("chat-1");
    expect(events).toEqual([
      { id: events[0]!.id, sessionId: "chat-1", turnId, ts: "2026-11-08T10:00:01.000Z", kind: "message", payload: { text: "hi" }, agent: "claude" },
      { id: events[1]!.id, sessionId: "chat-1", turnId, ts: "2026-11-08T10:00:02.000Z", kind: "result", agent: "claude" },
    ]);
    expect(events[1]!.id).toBeGreaterThan(events[0]!.id);
  });

  it("supports afterId, turn filter and limit for live polling", () => {
    for (const [turn, text] of [[turnId, "a"], [turnId, "b"], [otherTurnId, "c"], [otherTurnId, "d"]] as const) {
      store.recordEvent({ sessionId: "chat-1", turnId: turn, ts: "t", kind: "message", payload: { text }, agent: "claude" });
    }
    const texts = (events: { payload?: unknown }[]) => events.map((e) => (e.payload as { text: string }).text);
    const all = store.getEvents("chat-1");
    expect(texts(store.getEvents("chat-1", { afterId: all[1]!.id }))).toEqual(["c", "d"]);
    expect(texts(store.getEvents("chat-1", { turnId: otherTurnId }))).toEqual(["c", "d"]);
    expect(store.getEvents("chat-1", { limit: 3 })).toHaveLength(3);
  });

  it("keeps the events of one session apart from another's", () => {
    store.createSession({ ...SESSION, id: "chat-2" });
    const t = store.startTurn({ sessionId: "chat-2", prompt: "x", startedAt: "t" }).id;
    store.recordEvent({ sessionId: "chat-2", turnId: t, ts: "t", kind: "message", agent: "cursor" });
    expect(store.getEvents("chat-1")).toEqual([]);
    expect(store.getEvents("chat-2")).toHaveLength(1);
  });

  it("refuses an event for an unknown turn", () => {
    expect(() => store.recordEvent({ sessionId: "chat-1", turnId: 9999, ts: "t", kind: "message", agent: "claude" })).toThrow();
  });
});

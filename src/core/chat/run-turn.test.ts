import { describe, expect, it } from "vitest";
import type { AgentCapabilities, AgentRunRequest, AgentRunResult, AgentRunner } from "../ports/agent-runner.js";
import type {
  NewSession,
  NewTurn,
  SessionEventFilter,
  SessionEventRecord,
  SessionRecord,
  SessionStore,
  StoredSessionEvent,
  TurnOutcome,
  TurnRecord,
} from "../ports/session-store.js";
import { ChatError, runTurn, titleFromPrompt } from "./run-turn.js";

/** In-memory SessionStore: records exactly what the port was asked to do. */
class FakeSessionStore implements SessionStore {
  sessions = new Map<string, SessionRecord>();
  turns: TurnRecord[] = [];
  events: StoredSessionEvent[] = [];
  createSession(s: NewSession): void {
    this.sessions.set(s.id, { ...s, updatedAt: s.createdAt, status: "idle" });
  }
  getSession(id: string): SessionRecord | undefined {
    return this.sessions.get(id);
  }
  setAgentSessionId(id: string, agentSessionId: string, updatedAt: string): void {
    this.sessions.set(id, { ...this.sessions.get(id)!, agentSessionId, updatedAt });
  }
  listSessions(): SessionRecord[] {
    return [...this.sessions.values()];
  }
  startTurn(t: NewTurn): TurnRecord {
    const seq = this.turns.filter((x) => x.sessionId === t.sessionId).length + 1;
    const turn: TurnRecord = {
      id: this.turns.length + 1, sessionId: t.sessionId, seq, prompt: t.prompt, startedAt: t.startedAt, status: "running",
      ...(t.profile ? { profile: t.profile } : {}), ...(t.pid !== undefined ? { pid: t.pid } : {}),
    };
    this.turns.push(turn);
    this.sessions.set(t.sessionId, { ...this.sessions.get(t.sessionId)!, status: "running", updatedAt: t.startedAt });
    return turn;
  }
  finishTurn(turnId: number, o: TurnOutcome): void {
    const i = this.turns.findIndex((t) => t.id === turnId);
    const { pid: _pid, ...rest } = this.turns[i]!;
    const { exitCode, ...outcome } = o;
    this.turns[i] = { ...rest, ...outcome, ...(exitCode !== null && exitCode !== undefined ? { exitCode } : {}) };
    const sid = rest.sessionId;
    this.sessions.set(sid, { ...this.sessions.get(sid)!, status: "idle", updatedAt: o.finishedAt });
  }
  recordEvent(e: SessionEventRecord): void {
    this.events.push({ ...e, id: this.events.length + 1 });
  }
  listTurns(sessionId: string): TurnRecord[] {
    return this.turns.filter((t) => t.sessionId === sessionId);
  }
  getEvents(sessionId: string, _filter?: SessionEventFilter): StoredSessionEvent[] {
    return this.events.filter((e) => e.sessionId === sessionId);
  }
}

const CAN_RESUME: AgentCapabilities = { resume: true, chooseModel: true, commandList: true, visibleReasoning: false, planUsage: true };
const CANNOT_RESUME: AgentCapabilities = { resume: false, chooseModel: true, commandList: false, visibleReasoning: true, planUsage: false };

const OK: AgentRunResult = {
  exitCode: 0, isError: false, resultText: "the answer", durationMs: 5, inputTokens: 120, outputTokens: 30, sessionId: "agent-s1", timedOut: false,
  meta: { commands: ["usage"], planUsage: [{ name: "five_hour", utilization: 0.2 }], model: "m1" },
};

interface FakeAgent extends AgentRunner {
  requests: AgentRunRequest[];
}

function fakeAgent(
  name: string | undefined,
  capabilities: AgentCapabilities | undefined,
  script: (request: AgentRunRequest, emit: (type: string, raw: unknown) => void) => AgentRunResult | Promise<AgentRunResult> = () => OK,
): FakeAgent {
  const requests: AgentRunRequest[] = [];
  return {
    ...(name ? { name } : {}),
    ...(capabilities ? { capabilities } : {}),
    requests,
    run: async (request, onEvent) => {
      requests.push(request);
      return script(request, (type, raw) => onEvent?.({ type, raw }));
    },
  };
}

const claudeMessage = (text: string) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });

const clock = () => {
  let n = 0;
  return () => new Date(Date.UTC(2026, 10, 8, 10, 0, n++));
};

function setup(agent = "claude") {
  const store = new FakeSessionStore();
  store.createSession({ id: "chat-1", agent, title: "t", cwd: "/repo", createdAt: "2026-11-08T09:00:00.000Z" });
  return store;
}

const input = (extra: Partial<Parameters<typeof runTurn>[1]> = {}) => ({ sessionId: "chat-1", prompt: "plan it", timeoutMs: 1000, ...extra });

describe("runTurn", () => {
  it("records a first turn: prompt, normalized timeline labelled with the agent, result, tokens, exit code and meta", async () => {
    const store = setup();
    const agent = fakeAgent("claude", CAN_RESUME, (_r, emit) => {
      emit("system", { type: "system", subtype: "init", session_id: "agent-s1", model: "m1" });
      emit("assistant", claudeMessage("hello"));
      emit("result", { type: "result", result: "the answer" });
      return OK;
    });
    const at = new Date("2026-11-08T10:00:00.000Z");
    const summary = await runTurn({ agent, store, now: () => at }, input({ pid: 99 }));

    expect(agent.requests).toEqual([{ cwd: "/repo", prompt: "plan it", timeoutMs: 1000 }]);
    expect(summary).toMatchObject({ passed: true, result: OK, turn: { seq: 1, prompt: "plan it" } });
    expect(store.turns).toEqual([
      {
        id: 1, sessionId: "chat-1", seq: 1, prompt: "plan it", startedAt: "2026-11-08T10:00:00.000Z", finishedAt: "2026-11-08T10:00:00.000Z",
        status: "passed", resultText: "the answer", inputTokens: 120, outputTokens: 30, exitCode: 0, meta: OK.meta,
      },
    ]);
    expect(store.events.map((e) => [e.kind, e.agent, e.turnId, e.sessionId])).toEqual([
      ["system", "claude", 1, "chat-1"],
      ["message", "claude", 1, "chat-1"],
      ["result", "claude", 1, "chat-1"],
    ]);
    expect(store.events[1]!.payload).toEqual({ text: "hello" });
  });

  it("keeps the pid on the turn while it runs and drops it when it ends", async () => {
    const store = setup();
    let during: TurnRecord | undefined;
    const agent = fakeAgent("claude", CAN_RESUME, () => {
      during = store.turns[0];
      return OK;
    });
    await runTurn({ agent, store, now: clock() }, input({ pid: 99 }));
    expect(during).toMatchObject({ status: "running", pid: 99 });
    expect(store.turns[0]).not.toHaveProperty("pid");
    expect(store.getSession("chat-1")?.status).toBe("idle");
  });

  it("remembers the agent's own session id from the result", async () => {
    const store = setup();
    await runTurn({ agent: fakeAgent("claude", CAN_RESUME), store, now: clock() }, input());
    expect(store.getSession("chat-1")?.agentSessionId).toBe("agent-s1");
  });

  it("resumes the agent's session on the next turn when the runner can resume", async () => {
    const store = setup();
    const agent = fakeAgent("claude", CAN_RESUME);
    await runTurn({ agent, store, now: clock() }, input());
    await runTurn({ agent, store, now: clock() }, input({ prompt: "and then?" }));
    expect(agent.requests.map((r) => r.resumeSessionId)).toEqual([undefined, "agent-s1"]);
    expect(store.listTurns("chat-1").map((t) => t.seq)).toEqual([1, 2]);
  });

  it("refuses to resume with a runner that cannot, and records nothing", async () => {
    const store = setup("cursor");
    store.setAgentSessionId("chat-1", "agent-s1", "t");
    const agent = fakeAgent("cursor", CANNOT_RESUME);
    await expect(runTurn({ agent, store, now: clock() }, input())).rejects.toThrow(ChatError);
    await expect(runTurn({ agent, store, now: clock() }, input())).rejects.toThrow(/cannot resume/);
    expect(agent.requests).toEqual([]);
    expect(store.turns).toEqual([]);
    expect(store.events).toEqual([]);
    expect(store.getSession("chat-1")?.status).toBe("idle");
  });

  it("treats a runner that declares no capabilities as unable to resume", async () => {
    const store = setup();
    store.setAgentSessionId("chat-1", "agent-s1", "t");
    await expect(runTurn({ agent: fakeAgent("claude", undefined), store, now: clock() }, input())).rejects.toThrow(/cannot resume/);
  });

  it("starts a session without an agent session id fresh even with a runner that cannot resume", async () => {
    const store = setup("cursor");
    const agent = fakeAgent("cursor", CANNOT_RESUME);
    const summary = await runTurn({ agent, store, now: clock() }, input());
    expect(summary.passed).toBe(true);
    expect(agent.requests[0]).not.toHaveProperty("resumeSessionId");
  });

  it("fails clearly for an unknown session", async () => {
    await expect(runTurn({ agent: fakeAgent("claude", CAN_RESUME), store: new FakeSessionStore(), now: clock() }, input())).rejects.toThrow(
      "Session not found: chat-1",
    );
  });

  it("fails clearly when the runner is another agent than the session's", async () => {
    const store = setup("claude");
    const agent = fakeAgent("cursor", CANNOT_RESUME);
    await expect(runTurn({ agent, store, now: clock() }, input())).rejects.toThrow(/belongs to claude, not cursor/);
    expect(agent.requests).toEqual([]);
    expect(store.turns).toEqual([]);
  });

  it("normalizes Cursor's stream with Cursor's normalizer and labels it cursor", async () => {
    const store = setup("cursor");
    const agent = fakeAgent("cursor", CANNOT_RESUME, (_r, emit) => {
      emit("thinking", { type: "thinking", subtype: "delta", text: "Plan the edit" });
      emit("thinking", { type: "thinking", subtype: "completed" });
      emit("tool_call", { type: "tool_call", subtype: "started", call_id: "c1", tool_call: { shellToolCall: { args: { command: "ls" } } } });
      return OK;
    });
    await runTurn({ agent, store, now: clock() }, input());
    expect(store.events.map((e) => [e.kind, e.agent])).toEqual([["thinking", "cursor"], ["tool_started", "cursor"]]);
    expect(store.events[0]!.payload).toMatchObject({ text: "Plan the edit" });
  });

  it("passes the profile to the agent and stores it on the turn", async () => {
    const store = setup();
    const agent = fakeAgent("claude", CAN_RESUME);
    await runTurn({ agent, store, now: clock() }, input({ profile: { model: "opus", effort: "high", permissionMode: "plan" } }));
    expect(agent.requests[0]!.profile).toEqual({ model: "opus", effort: "high", permissionMode: "plan" });
    expect(store.turns[0]!.profile).toEqual({ model: "opus", effort: "high", permissionMode: "plan" });
  });

  it("reports the turn and each stored timeline entry to the caller as they happen", async () => {
    const store = setup();
    const seen: string[] = [];
    const agent = fakeAgent("claude", CAN_RESUME, (_r, emit) => {
      seen.push(`agent:${store.events.length}`);
      emit("assistant", claudeMessage("one"));
      seen.push(`agent:${store.events.length}`);
      emit("assistant", claudeMessage("two"));
      return OK;
    });
    await runTurn(
      { agent, store, now: clock() },
      input({ onTurnStart: (t) => seen.push(`turn:${t.seq}`), onEvent: (e) => seen.push(`event:${(e.payload as { text: string }).text}`) }),
    );
    expect(seen).toEqual(["turn:1", "agent:0", "event:one", "agent:1", "event:two"]);
  });

  it("records a failed result as a failed turn and still remembers the session id", async () => {
    const store = setup();
    const failed: AgentRunResult = { exitCode: 1, isError: true, resultText: "model exploded", durationMs: 3, sessionId: "agent-s1", timedOut: false };
    const summary = await runTurn({ agent: fakeAgent("claude", CAN_RESUME, () => failed), store, now: clock() }, input());
    expect(summary.passed).toBe(false);
    expect(store.turns[0]).toMatchObject({ status: "failed", resultText: "model exploded", exitCode: 1 });
    expect(store.getSession("chat-1")).toMatchObject({ agentSessionId: "agent-s1", status: "idle" });
  });

  it("records a timed out turn as failed, without an exit code", async () => {
    const store = setup();
    const timedOut: AgentRunResult = { exitCode: null, isError: true, resultText: "Agent timed out", durationMs: 1000, timedOut: true };
    const summary = await runTurn({ agent: fakeAgent("claude", CAN_RESUME, () => timedOut), store, now: clock() }, input());
    expect(summary.passed).toBe(false);
    expect(store.turns[0]).toMatchObject({ status: "failed", resultText: "Agent timed out" });
    expect(store.turns[0]).not.toHaveProperty("exitCode");
    expect(store.getSession("chat-1")).not.toHaveProperty("agentSessionId");
  });

  it("treats a zero exit code with an error result as failed", async () => {
    const store = setup();
    const odd: AgentRunResult = { ...OK, isError: true };
    const summary = await runTurn({ agent: fakeAgent("claude", CAN_RESUME, () => odd), store, now: clock() }, input());
    expect(summary.passed).toBe(false);
    expect(store.turns[0]!.status).toBe("failed");
  });

  it("flushes buffered timeline entries and closes the turn when the agent throws, then rethrows", async () => {
    const store = setup("cursor");
    const agent = fakeAgent("cursor", CANNOT_RESUME, (_r, emit) => {
      emit("thinking", { type: "thinking", subtype: "delta", text: "half a thought" });
      throw new Error("spawn exploded");
    });
    await expect(runTurn({ agent, store, now: clock() }, input({ pid: 5 }))).rejects.toThrow("spawn exploded");
    expect(store.events.map((e) => [e.kind, (e.payload as { text?: string }).text])).toEqual([["thinking", "half a thought"]]);
    expect(store.turns[0]).toMatchObject({ status: "failed", resultText: "Agent error: spawn exploded" });
    expect(store.turns[0]).not.toHaveProperty("pid");
    expect(store.getSession("chat-1")?.status).toBe("idle");
  });

  it("does not replace the stored agent session id when a later result carries none", async () => {
    const store = setup();
    store.setAgentSessionId("chat-1", "agent-s1", "t");
    const noId: AgentRunResult = { ...OK };
    delete noId.sessionId;
    await runTurn({ agent: fakeAgent("claude", CAN_RESUME, () => noId), store, now: clock() }, input());
    expect(store.getSession("chat-1")?.agentSessionId).toBe("agent-s1");
  });
});

describe("titleFromPrompt", () => {
  it("uses the first non-empty line with collapsed whitespace", () => {
    expect(titleFromPrompt("\n\n  Plan   the\tboard  \nsecond line")).toBe("Plan the board");
  });

  it("shortens a long prompt with an ellipsis", () => {
    const title = titleFromPrompt("x".repeat(200));
    expect(title).toHaveLength(60);
    expect(title.endsWith("…")).toBe(true);
  });

  it("falls back to a generic title for a blank prompt", () => {
    expect(titleFromPrompt("   \n ")).toBe("Untitled chat");
  });
});

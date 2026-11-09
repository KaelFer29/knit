import { describe, expect, it } from "vitest";
import type { SessionDetail, SessionEvent, SessionListEntry } from "../sessions/types";
import { glimpseOf, latestSession } from "./glimpse";

const entry = (id: string, updatedAt: string): SessionListEntry => ({
  session: { id, agent: "claude", title: id, cwd: "/", createdAt: updatedAt, updatedAt, status: "idle" },
  turnCount: 1,
  inputTokens: 0,
  outputTokens: 0,
});

describe("latestSession", () => {
  it("picks the most recently updated session, or none", () => {
    expect(latestSession([entry("a", "2026-01-01T00:00:00Z"), entry("b", "2026-01-02T00:00:00Z")])?.session.id).toBe("b");
    expect(latestSession([])).toBeUndefined();
  });
});

describe("glimpseOf", () => {
  it("keeps the state, the last prompt and the last three timeline lines", () => {
    const detail: SessionDetail = {
      session: { ...entry("s", "2026-01-01T00:00:00Z").session, title: "Plan", status: "running" },
      turns: [{ id: 1, sessionId: "s", seq: 1, prompt: "Write\nthe plan", startedAt: "2026-01-01T00:00:00Z", status: "running" }],
      meta: { commands: [], planUsage: [] },
      lastEventId: 3,
    };
    const events: SessionEvent[] = [1, 2, 3].map((n) => ({ id: n, turnId: 1, ts: "t", kind: "message", payload: { text: `step ${n}` }, agent: "claude" }));
    const g = glimpseOf(detail, events);
    expect(g).toMatchObject({ status: "running", title: "Plan", lastPrompt: "Write the plan" });
    expect(g.lines).toEqual(["step 1", "step 2", "step 3"]);
  });
});

describe("glimpseOf details", () => {
  const base = (over: Partial<SessionDetail> = {}): SessionDetail => ({
    session: { ...entry("s", "2026-01-01T00:00:00Z").session, status: "running" },
    turns: [
      { id: 1, sessionId: "s", seq: 1, prompt: "one", startedAt: "t", status: "passed", inputTokens: 1200, outputTokens: 50, profile: { model: "sonnet" } },
      { id: 2, sessionId: "s", seq: 2, prompt: "two", startedAt: "t", status: "running" },
    ],
    meta: { commands: [], planUsage: [{ name: "five_hour", utilization: 0.42 }], model: "claude-opus-5-5" },
    lastEventId: 0,
    ...over,
  });
  const tool = (id: number, kind: string, payload: Record<string, unknown>): SessionEvent => ({ id, turnId: 2, ts: "t", kind, payload, agent: "claude" });

  it("keeps the model, the input of the last finished turn, the turn count and the plan usage", () => {
    const g = glimpseOf(base(), []);
    expect(g).toMatchObject({ model: "claude-opus-5-5", contextTokens: 1200, turns: 2, planUsage: [{ name: "five_hour", utilization: 0.42 }] });
  });

  it("falls back to the model of the last turn's profile when the agent did not report one", () => {
    expect(glimpseOf(base({ meta: { commands: [], planUsage: [] } }), []).model).toBe("sonnet");
  });

  it("lists the subagents still running, by their description", () => {
    const events = [
      tool(1, "tool_started", { tool: "Task", callId: "a", args: { description: "Map the server", subagent_type: "Explore" } }),
      tool(2, "tool_started", { tool: "Agent", callId: "b", args: { description: "Write tests" } }),
      tool(3, "tool_completed", { callId: "b", result: "ok" }),
      tool(4, "tool_started", { tool: "Read", callId: "c", args: { file_path: "x" } }),
    ];
    expect(glimpseOf(base(), events).agents).toEqual(["Map the server"]);
  });
});

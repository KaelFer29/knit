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

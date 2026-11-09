import { describe, expect, it } from "vitest";
import { buildTimeline } from "./timeline";
import type { SessionEvent, Turn } from "./types";

const turn = (over: Partial<Turn> = {}): Turn => ({ id: 1, sessionId: "s", seq: 1, prompt: "do it", startedAt: "t", status: "passed", ...over });
let n = 0;
const ev = (kind: string, payload: unknown, turnId = 1): SessionEvent => ({ id: ++n, turnId, ts: "t", kind, payload, agent: "x" });

describe("buildTimeline", () => {
  it("starts every turn with its prompt and the model it was run with", () => {
    const items = buildTimeline([turn({ profile: { model: "opus" } })], []);
    expect(items).toEqual([{ type: "prompt", key: "turn-1", seq: 1, text: "do it", model: "opus", at: "t" }]);
  });

  it("dates the prompt by its turn and a message by its event, so the page can show when each was said", () => {
    const items = buildTimeline([turn({ startedAt: "2026-11-09T10:00:00Z" })], [{ ...ev("message", { text: "hi" }), ts: "2026-11-09T10:00:05Z" }]);
    expect(items.map((i) => ("at" in i ? i.at : undefined))).toEqual(["2026-11-09T10:00:00Z", "2026-11-09T10:00:05Z"]);
  });

  it("pairs a tool call with its result by call id and keeps arguments as text", () => {
    const items = buildTimeline(
      [turn()],
      [ev("tool_started", { tool: "Bash", callId: "c1", args: { command: "ls" } }), ev("message", { text: "hm" }), ev("tool_completed", { callId: "c1", result: "a\nb", isError: true })],
    );
    const tool = items.find((i) => i.type === "tool");
    expect(tool).toMatchObject({ tool: "Bash", args: '{\n  "command": "ls"\n}', result: "a\nb", isError: true, done: true });
    expect(items.map((i) => i.type)).toEqual(["prompt", "tool", "message"]);
  });

  it("marks an unfinished tool call and keeps an orphan result", () => {
    const items = buildTimeline([turn()], [ev("tool_started", { tool: "Read", callId: "c2" }), ev("tool_completed", { callId: "zzz", tool: "Edit", result: "ok" })]);
    expect(items[1]).toMatchObject({ type: "tool", tool: "Read", done: false });
    expect(items[2]).toMatchObject({ type: "tool", tool: "Edit", done: true, result: "ok" });
  });

  it("says when reasoning is not shared: an empty block flagged by the adapter, or an empty block with no flag", () => {
    const items = buildTimeline([turn()], [ev("thinking", { text: "", shared: false }), ev("thinking", { text: "I think" }), ev("thinking", { text: "" })]);
    expect(items.filter((i) => i.type === "thinking").map((i) => (i as { shared: boolean }).shared)).toEqual([false, true, false]);
  });

  it("ends a finished turn with its result and the turn's tokens", () => {
    const items = buildTimeline([turn({ inputTokens: 100, outputTokens: 20 })], [ev("result", { text: "done", durationMs: 5, isError: false })]);
    expect(items.at(-1)).toMatchObject({ type: "result", text: "done", durationMs: 5, inputTokens: 100, outputTokens: 20 });
  });

  it("keeps a failure visible when the process left no result entry", () => {
    const items = buildTimeline([turn({ status: "failed", resultText: "Aborted" })], []);
    expect(items.at(-1)).toMatchObject({ type: "result", text: "Aborted", isError: true });
  });

  it("shows a working marker for a running turn and ignores system and echoed prompt entries", () => {
    const items = buildTimeline([turn({ status: "running" })], [ev("system", { model: "m" }), ev("prompt", { text: "echo" }), ev("other", {})]);
    expect(items.map((i) => i.type)).toEqual(["prompt", "working"]);
  });

  it("keeps each turn's events with its own turn", () => {
    const items = buildTimeline([turn(), turn({ id: 2, seq: 2, prompt: "again" })], [ev("message", { text: "second" }, 2), ev("message", { text: "first" }, 1)]);
    expect(items.map((i) => (i.type === "prompt" || i.type === "message" ? i.text : i.type))).toEqual(["do it", "first", "again", "second"]);
  });

  it("does not choke on payloads of the wrong shape", () => {
    expect(() => buildTimeline([turn()], [ev("message", "text"), ev("tool_started", null), ev("result", 5)])).not.toThrow();
  });
});

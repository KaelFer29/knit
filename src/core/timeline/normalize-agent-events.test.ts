import { describe, expect, it } from "vitest";
import { AgentEventNormalizer } from "./normalize-agent-events.js";

const delta = (text: string) => ({ type: "thinking", subtype: "delta", text });
const completed = { type: "thinking", subtype: "completed" };

describe("AgentEventNormalizer", () => {
  it("maps the init event and the prompt", () => {
    const n = new AgentEventNormalizer();
    expect(n.push({ type: "system", subtype: "init", model: "Auto", permissionMode: "default", session_id: "s1" })).toEqual([
      { kind: "system", payload: { model: "Auto", permissionMode: "default", sessionId: "s1" } },
    ]);
    expect(n.push({ type: "user", message: { role: "user", content: [{ type: "text", text: "Do it" }] } })).toEqual([
      { kind: "prompt", payload: { text: "Do it" } },
    ]);
  });

  it("coalesces thinking deltas until the thinking completes", () => {
    const n = new AgentEventNormalizer();
    expect(n.push(delta("Hel"))).toEqual([]);
    expect(n.push(delta("lo"))).toEqual([]);
    expect(n.push(completed)).toEqual([{ kind: "thinking", payload: { text: "Hello" } }]);
    expect(n.push(completed)).toEqual([]);
  });

  it("flushes thinking when the buffer reaches the size threshold", () => {
    const n = new AgentEventNormalizer({ thinkingFlushChars: 5 });
    expect(n.push(delta("abc"))).toEqual([]);
    expect(n.push(delta("def"))).toEqual([{ kind: "thinking", payload: { text: "abcdef" } }]);
    expect(n.flush()).toEqual([]);
  });

  it("flushes pending thinking before any other event, keeping order", () => {
    const n = new AgentEventNormalizer();
    n.push(delta("x"));
    const out = n.push({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Hi" }] } });
    expect(out.map((e) => e.kind)).toEqual(["thinking", "message"]);
    expect(out[1]!.payload).toEqual({ text: "Hi" });
  });

  it("flush() returns what is still buffered", () => {
    const n = new AgentEventNormalizer();
    n.push(delta("tail"));
    expect(n.flush()).toEqual([{ kind: "thinking", payload: { text: "tail" } }]);
    expect(n.flush()).toEqual([]);
  });

  it("joins only the text parts of an assistant message", () => {
    const n = new AgentEventNormalizer();
    const out = n.push({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "A" }, { type: "image" }, { type: "text", text: "B" }] },
    });
    expect(out).toEqual([{ kind: "message", payload: { text: "AB" } }]);
  });

  it("maps tool calls with the tool name, call id, arguments and result", () => {
    const n = new AgentEventNormalizer();
    const started = n.push({
      type: "tool_call", subtype: "started", call_id: "c1",
      tool_call: { shellToolCall: { args: { command: "ls" } }, hookAdditionalContexts: [] },
    });
    expect(started).toEqual([{ kind: "tool_started", payload: { tool: "shellToolCall", callId: "c1", args: { command: "ls" } } }]);
    const done = n.push({
      type: "tool_call", subtype: "completed", call_id: "c1",
      tool_call: { shellToolCall: { args: { command: "ls" }, result: { success: { stdout: "a\n" } } } },
    });
    expect(done).toEqual([{ kind: "tool_completed", payload: { tool: "shellToolCall", callId: "c1", result: { success: { stdout: "a\n" } } } }]);
  });

  it("falls back to the first key for the tool name, or 'unknown'", () => {
    const n = new AgentEventNormalizer();
    expect(n.push({ type: "tool_call", subtype: "started", call_id: "c", tool_call: { weird: { args: {} } } })[0]!.payload).toMatchObject({ tool: "weird" });
    expect(n.push({ type: "tool_call", subtype: "started", call_id: "c", tool_call: {} })[0]!.payload).toMatchObject({ tool: "unknown" });
  });

  it("clips long strings anywhere in arguments and results, and says how much was cut", () => {
    const n = new AgentEventNormalizer({ maxStringChars: 20 });
    const out = n.push({
      type: "tool_call", subtype: "completed", call_id: "c",
      tool_call: { readToolCall: { result: { success: { content: "x".repeat(100), lines: ["y".repeat(30), "ok"] } } } },
    });
    const result = (out[0]!.payload as { result: { success: { content: string; lines: string[] } } }).result.success;
    expect(result.content).toBe(`${"x".repeat(20)}… [truncated 80 chars]`);
    expect(result.lines).toEqual([`${"y".repeat(20)}… [truncated 10 chars]`, "ok"]);
  });

  it("maps the final result", () => {
    const n = new AgentEventNormalizer();
    expect(n.push({ type: "result", subtype: "success", is_error: false, result: "done", duration_ms: 5, usage: { inputTokens: 10, outputTokens: 2 } })).toEqual([
      { kind: "result", payload: { text: "done", isError: false, durationMs: 5, usage: { inputTokens: 10, outputTokens: 2 } } },
    ]);
  });

  it("keeps unknown event types as 'other' and ignores non-objects", () => {
    const n = new AgentEventNormalizer();
    expect(n.push({ type: "brand_new", subtype: "x", foo: 1 })).toEqual([
      { kind: "other", payload: { type: "brand_new", subtype: "x", raw: { type: "brand_new", subtype: "x", foo: 1 } } },
    ]);
    expect(n.push("garbage")).toEqual([]);
    expect(n.push(null)).toEqual([]);
  });
});

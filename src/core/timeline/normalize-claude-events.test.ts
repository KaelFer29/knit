import { describe, expect, it } from "vitest";
import { ClaudeEventNormalizer, claudeTokenUsage } from "./normalize-claude-events.js";

const assistant = (...content: unknown[]) => ({ type: "assistant", message: { role: "assistant", content } });
const toolResult = (id: string, content: unknown, isError = false) => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
});

describe("ClaudeEventNormalizer", () => {
  it("maps system/init to a system entry with the same fields as Cursor", () => {
    const n = new ClaudeEventNormalizer();
    expect(
      n.push({ type: "system", subtype: "init", model: "claude-haiku-5-5", permissionMode: "default", session_id: "s1", tools: ["Bash"] }),
    ).toEqual([{ kind: "system", payload: { model: "claude-haiku-5-5", permissionMode: "default", sessionId: "s1" } }]);
  });

  it("keeps other system subtypes and rate limit events as 'other'", () => {
    const n = new ClaudeEventNormalizer();
    expect(n.push({ type: "system", subtype: "hook_started", hook_name: "x" })).toEqual([
      { kind: "other", payload: { type: "system", subtype: "hook_started", raw: { type: "system", subtype: "hook_started", hook_name: "x" } } },
    ]);
    expect(n.push({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } })[0]).toMatchObject({
      kind: "other",
      payload: { type: "rate_limit_event" },
    });
  });

  it("maps assistant text to a message", () => {
    const n = new ClaudeEventNormalizer();
    expect(n.push(assistant({ type: "text", text: "ok" }))).toEqual([{ kind: "message", payload: { text: "ok" } }]);
  });

  it("marks empty thinking blocks as not shared", () => {
    const n = new ClaudeEventNormalizer();
    expect(n.push(assistant({ type: "thinking", thinking: "", signature: "sig" }))).toEqual([
      { kind: "thinking", payload: { text: "", shared: false } },
    ]);
  });

  it("emits readable thinking as shared", () => {
    const n = new ClaudeEventNormalizer();
    expect(n.push(assistant({ type: "thinking", thinking: "Let me see", signature: "sig" }))).toEqual([
      { kind: "thinking", payload: { text: "Let me see", shared: true } },
    ]);
  });

  it("keeps the order of the blocks of one assistant event", () => {
    const n = new ClaudeEventNormalizer();
    const out = n.push(
      assistant(
        { type: "thinking", thinking: "", signature: "s" },
        { type: "text", text: "Running it" },
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
      ),
    );
    expect(out.map((e) => e.kind)).toEqual(["thinking", "message", "tool_started"]);
  });

  it("maps tool_use to tool_started and the matching tool_result to tool_completed", () => {
    const n = new ClaudeEventNormalizer();
    expect(n.push(assistant({ type: "tool_use", id: "t1", name: "Bash", input: { command: "echo hi" } }))).toEqual([
      { kind: "tool_started", payload: { tool: "Bash", callId: "t1", args: { command: "echo hi" } } },
    ]);
    expect(n.push(toolResult("t1", "hi"))).toEqual([
      { kind: "tool_completed", payload: { tool: "Bash", callId: "t1", result: "hi" } },
    ]);
  });

  it("matches results by id, in any order, and flags failed tools", () => {
    const n = new ClaudeEventNormalizer();
    n.push(assistant({ type: "tool_use", id: "a", name: "Read", input: {} }, { type: "tool_use", id: "b", name: "Bash", input: {} }));
    expect(n.push(toolResult("b", "boom", true))).toEqual([
      { kind: "tool_completed", payload: { tool: "Bash", callId: "b", result: "boom", isError: true } },
    ]);
    expect(n.push(toolResult("a", [{ type: "text", text: "file" }]))[0]!.payload).toMatchObject({ tool: "Read", callId: "a" });
  });

  it("reports a result for an unknown call id without a tool name", () => {
    const n = new ClaudeEventNormalizer();
    expect(n.push(toolResult("zzz", "x"))).toEqual([{ kind: "tool_completed", payload: { callId: "zzz", result: "x" } }]);
  });

  it("clips long strings like the Cursor normalizer does", () => {
    const n = new ClaudeEventNormalizer({ maxStringChars: 20 });
    expect(n.push(assistant({ type: "text", text: "x".repeat(100) }))).toEqual([
      { kind: "message", payload: { text: `${"x".repeat(20)}… [truncated 80 chars]` } },
    ]);
    n.push(assistant({ type: "tool_use", id: "c", name: "Write", input: { content: "y".repeat(30), keep: "ok" } }));
    const done = n.push(toolResult("c", "z".repeat(25)));
    expect(done[0]!.payload).toMatchObject({ result: `${"z".repeat(20)}… [truncated 5 chars]` });
  });

  it("clips the arguments of a tool call", () => {
    const n = new ClaudeEventNormalizer({ maxStringChars: 20 });
    const out = n.push(assistant({ type: "tool_use", id: "c", name: "Write", input: { content: "y".repeat(30), keep: "ok" } }));
    expect(out[0]!.payload).toMatchObject({ args: { content: `${"y".repeat(20)}… [truncated 10 chars]`, keep: "ok" } });
  });

  it("maps a plain user message to a prompt", () => {
    const n = new ClaudeEventNormalizer();
    expect(n.push({ type: "user", message: { role: "user", content: "Do it" } })).toEqual([{ kind: "prompt", payload: { text: "Do it" } }]);
    expect(n.push({ type: "user", message: { role: "user", content: [{ type: "text", text: "Again" }] } })).toEqual([
      { kind: "prompt", payload: { text: "Again" } },
    ]);
  });

  it("tags subagent activity with its parent call", () => {
    const n = new ClaudeEventNormalizer();
    const out = n.push({ ...assistant({ type: "text", text: "inner" }), parent_tool_use_id: "task1" });
    expect(out).toEqual([{ kind: "message", payload: { text: "inner", parentCallId: "task1" } }]);
  });

  it("maps the final result with Cursor-shaped usage", () => {
    const n = new ClaudeEventNormalizer();
    const out = n.push({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "ok",
      duration_ms: 3659,
      usage: { input_tokens: 4, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 81 },
    });
    expect(out).toEqual([
      {
        kind: "result",
        payload: {
          text: "ok",
          isError: false,
          durationMs: 3659,
          usage: { inputTokens: 1104, outputTokens: 81, cacheCreationTokens: 100, cacheReadTokens: 1000 },
        },
      },
    ]);
  });

  it("flush() has nothing to return (nothing is buffered) and non-objects are ignored", () => {
    const n = new ClaudeEventNormalizer();
    expect(n.flush()).toEqual([]);
    expect(n.push("garbage")).toEqual([]);
    expect(n.push(null)).toEqual([]);
    expect(n.push({ type: "assistant" })).toEqual([]);
  });
});

describe("claudeTokenUsage", () => {
  it("counts input as new plus cache-creation plus cache-read tokens", () => {
    expect(claudeTokenUsage({ input_tokens: 4, cache_creation_input_tokens: 42300, cache_read_input_tokens: 91444, output_tokens: 81 })).toEqual({
      inputTokens: 133748,
      outputTokens: 81,
      cacheCreationTokens: 42300,
      cacheReadTokens: 91444,
    });
  });

  it("treats missing fields as zero and returns undefined without a usage object", () => {
    expect(claudeTokenUsage({ output_tokens: 5 })).toEqual({ inputTokens: 0, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0 });
    expect(claudeTokenUsage(undefined)).toBeUndefined();
    expect(claudeTokenUsage("x")).toBeUndefined();
  });
});

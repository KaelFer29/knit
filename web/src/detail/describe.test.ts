import type { AttemptView } from "@board";
import { describe, expect, it } from "vitest";
import { clip, describeEntry, retryFeedback, tail, verdictsOf } from "./describe";

const attempt = (init: Partial<AttemptView>): AttemptView => ({ attempt: 1, setup: false, status: "failed", ...init });
const NONE = { gitProblems: [] };

describe("describeEntry", () => {
  it("describes messages, tool calls and results as text", () => {
    expect(describeEntry({ kind: "message", payload: { text: "hello" } })).toMatchObject({ label: "Message", text: "hello", mono: false });
    expect(describeEntry({ kind: "tool_started", payload: { tool: "readToolCall", args: { path: "a.ts" } } })).toEqual({
      label: "Tool: readToolCall",
      text: '{"path":"a.ts"}',
      mono: true,
      error: false,
    });
    expect(describeEntry({ kind: "tool_completed", payload: { tool: "shell", result: "ok", isError: true } })).toMatchObject({ error: true, text: "ok" });
    expect(describeEntry({ kind: "result", payload: { text: "done", isError: false } })).toMatchObject({ label: "Result", text: "done" });
  });

  it("copes with unknown kinds and missing payloads", () => {
    expect(describeEntry({ kind: "other", payload: { type: "x", subtype: "y" } }).text).toBe("x · y");
    expect(describeEntry({ kind: "thinking" })).toMatchObject({ label: "Thinking", text: "" });
    expect(describeEntry({ kind: "system", payload: { model: "m", permissionMode: "plan" } }).text).toBe("m · plan");
  });

  it("clips long text", () => {
    expect(clip("x".repeat(700)).length).toBe(601);
  });
});

describe("tail", () => {
  it("keeps the last lines and marks the cut", () => {
    const text = Array.from({ length: 20 }, (_, i) => `l${i + 1}`).join("\n");
    expect(tail(text, 3)).toBe("…\nl18\nl19\nl20");
    expect(tail("a\nb\n", 3)).toBe("a\nb");
  });
});

describe("verdictsOf", () => {
  it("is empty while the attempt is open", () => {
    expect(verdictsOf(attempt({ status: "running" }), NONE)).toEqual([]);
  });

  it("reports checks, scope and commit history for a finished attempt", () => {
    expect(verdictsOf(attempt({ status: "passed", scopeOk: true }), NONE)).toEqual([
      { label: "Checks", ok: true },
      { label: "Scope", ok: true },
      { label: "Git", ok: true },
    ]);
    const failed = verdictsOf(attempt({ failedCheck: "pnpm test", scopeOk: false }), { gitProblems: ["extra commit"] });
    expect(failed.filter((v) => !v.ok).map((v) => v.label)).toEqual(["Checks", "Scope", "Git"]);
    expect(failed[0]).toMatchObject({ detail: "pnpm test" });
  });

  it("reports only the setup command for attempt 0", () => {
    expect(verdictsOf(attempt({ attempt: 0, setup: true, status: "failed", failedCheck: "pnpm install" }), NONE)).toEqual([
      { label: "Setup command", ok: false, detail: "pnpm install" },
    ]);
  });
});

describe("retryFeedback", () => {
  it("lists what failed in the previous attempt", () => {
    expect(retryFeedback(attempt({ failedCheck: "pnpm test", scopeOk: false }), NONE)).toEqual([
      "Checks: pnpm test",
      "Scope: Files outside the allowed list were changed",
    ]);
  });

  it("is empty when the previous attempt passed or was the setup", () => {
    expect(retryFeedback(attempt({ status: "passed", scopeOk: true }), NONE)).toEqual([]);
    expect(retryFeedback(attempt({ attempt: 0, setup: true, failedCheck: "x" }), NONE)).toEqual([]);
  });
});

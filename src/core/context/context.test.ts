import { describe, expect, it } from "vitest";
import { DEFAULT_WINDOW, contextShare, contextTokensOf, contextWindowOf } from "./context.js";

describe("contextTokensOf", () => {
  it("adds what the chat sent fresh to what it read from and wrote to the cache", () => {
    expect(contextTokensOf({ inputTokens: 93, outputTokens: 77, cacheReadTokens: 12288, cacheWriteTokens: 0 })).toBe(12381);
    expect(contextTokensOf({ inputTokens: 12199, outputTokens: 127, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(12199);
    expect(contextTokensOf({ inputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 30 })).toBe(60);
  });

  it("does not count what the agent wrote: it enters the context of the next turn", () => {
    expect(contextTokensOf({ inputTokens: 100, outputTokens: 5000 })).toBe(100);
  });

  it("is unknown when the agent reported no input at all, and ignores values that are not numbers", () => {
    expect(contextTokensOf(undefined)).toBeUndefined();
    expect(contextTokensOf({})).toBeUndefined();
    expect(contextTokensOf({ outputTokens: 5 })).toBeUndefined();
    expect(contextTokensOf({ inputTokens: 10, cacheReadTokens: "x" as unknown as number })).toBe(10);
    expect(contextTokensOf({ inputTokens: -5 })).toBeUndefined();
  });
});

describe("contextWindowOf", () => {
  it("reads the window a model id carries", () => {
    expect(contextWindowOf("claude-opus-4-8[context=1m,effort=high,fast=false]")).toBe(1_000_000);
    expect(contextWindowOf("some-model[context=200k]")).toBe(200_000);
    expect(contextWindowOf("some-model[context=128000]")).toBe(128_000);
  });

  it("falls back to the default when the id says nothing, or says something unreadable", () => {
    expect(contextWindowOf("composer-2.5-fast")).toBe(DEFAULT_WINDOW);
    expect(contextWindowOf(undefined)).toBe(DEFAULT_WINDOW);
    expect(contextWindowOf("m[context=lots]")).toBe(DEFAULT_WINDOW);
    expect(contextWindowOf("m[context=0]")).toBe(DEFAULT_WINDOW);
  });
});

describe("contextShare", () => {
  it("is the fraction of the window in use, never above one", () => {
    expect(contextShare(50_000, 200_000)).toBe(0.25);
    expect(contextShare(300_000, 200_000)).toBe(1);
    expect(contextShare(0, 200_000)).toBe(0);
  });
});

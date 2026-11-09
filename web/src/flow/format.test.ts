import { describe, expect, it } from "vitest";
import { formatDuration, formatTokens, prLabel, safeHttpUrl, shortSha, totalTokens } from "./format";

describe("formatTokens", () => {
  it("keeps small numbers exact and abbreviates large ones", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(842)).toBe("842");
    expect(formatTokens(1_000)).toBe("1k");
    expect(formatTokens(4_900)).toBe("4.9k");
    expect(formatTokens(42_100)).toBe("42.1k");
    expect(formatTokens(158_000)).toBe("158k");
    expect(formatTokens(1_250_000)).toBe("1.25M");
  });
});

describe("totalTokens", () => {
  it("adds input and output", () => {
    expect(totalTokens({ input: 38_200, output: 4_900 })).toBe(43_100);
  });
});

describe("formatDuration", () => {
  it("reads as seconds, minutes or hours", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(14_000)).toBe("14s");
    expect(formatDuration(5 * 60_000 + 14_000)).toBe("5m 14s");
    expect(formatDuration(21 * 60_000)).toBe("21m");
    expect(formatDuration(75 * 60_000)).toBe("1h 15m");
  });
});

describe("shortSha", () => {
  it("keeps the first seven characters", () => {
    expect(shortSha("3a1f9c2e8b7d")).toBe("3a1f9c2");
    expect(shortSha("9c41e07")).toBe("9c41e07");
  });
});

describe("prLabel", () => {
  it("reads the number from a pull request URL", () => {
    expect(prLabel("https://github.com/acme/shop/pull/42")).toBe("PR #42");
    expect(prLabel("https://github.com/acme/shop/pull/42/files")).toBe("PR #42");
  });

  it("falls back to a plain label", () => {
    expect(prLabel("https://example.com/merge/abc")).toBe("PR");
  });
});

describe("safeHttpUrl", () => {
  it("only lets http and https links through", () => {
    expect(safeHttpUrl("https://github.com/a/b/pull/1")).toBe("https://github.com/a/b/pull/1");
    expect(safeHttpUrl("http://localhost:3000/x")).toBe("http://localhost:3000/x");
    expect(safeHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpUrl("data:text/html,<b>x</b>")).toBeUndefined();
    expect(safeHttpUrl("not a url")).toBeUndefined();
    expect(safeHttpUrl(undefined)).toBeUndefined();
  });
});

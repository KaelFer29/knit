import { describe, expect, it } from "vitest";
import { parseUsageText } from "./usage-text.js";

// Recorded from `claude -p --output-format json --no-session-persistence -- /usage` (Claude Code 2.1.319).
const RECORDED = `You are currently using your subscription to power your Claude Code usage

Current session: 36% used · resets Nov 9, 3:10am (America/Santiago)
Current week (all models): 50% used · resets Nov 12, 1am (America/Santiago)

What's contributing to your usage?
Approximate · sessions on this machine only · shares overlap

Last 24h · 1765 requests · 9 sessions
  89%  Give "general-purpose" subagents a cheaper model`;

describe("parseUsageText", () => {
  it("reads each plan window with its percentage and reset time, in order", () => {
    expect(parseUsageText(RECORDED)).toEqual([
      { label: "Current session", percent: 36, resets: "Nov 9, 3:10am (America/Santiago)" },
      { label: "Current week (all models)", percent: 50, resets: "Nov 12, 1am (America/Santiago)" },
    ]);
  });

  it("ignores the tips below, which also carry percentages", () => {
    expect(parseUsageText(RECORDED).some((w) => w.label.includes("subagents"))).toBe(false);
  });

  it("keeps a window without a reset time, and clamps the percentage", () => {
    expect(parseUsageText("Current week (Opus): 130% used")).toEqual([{ label: "Current week (Opus)", percent: 100 }]);
  });

  it("finds nothing in text that has no windows", () => {
    expect(parseUsageText("You are using an API key.")).toEqual([]);
  });
});

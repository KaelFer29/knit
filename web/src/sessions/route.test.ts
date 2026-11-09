import { describe, expect, it } from "vitest";
import { routedPrompt } from "./route";

describe("routedPrompt", () => {
  it("keeps the request verbatim and asks for a plan in the Knit format under docs/plans", () => {
    const text = routedPrompt("  Add webhooks\nwith retries  ");
    expect(text).toContain("Add webhooks\nwith retries");
    expect(text).toContain("docs/plan-format.md");
    expect(text).toContain("docs/plans/");
  });

  it("tells the agent not to implement anything or start a run", () => {
    expect(routedPrompt("x")).toMatch(/do not implement/i);
    expect(routedPrompt("x")).toMatch(/do not start a run/i);
  });

  it("puts the request last, so the agent reads the rules first", () => {
    const text = routedPrompt("MY REQUEST");
    expect(text.endsWith("MY REQUEST")).toBe(true);
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UsagePanel } from "./UsagePanel";

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);

describe("UsagePanel", () => {
  it("shows each plan window with its percentage and reset, and the session tokens", () => {
    render(
      <UsagePanel
        reportsPlanUsage
        planUsage={[
          { name: "five_hour", utilization: 0.38, resetsAt: NOW / 1000 + 2 * 3600 + 600 },
          { name: "seven_day", utilization: 0.96 },
        ]}
        inputTokens={12_000}
        outputTokens={3_400}
        now={NOW}
      />,
    );
    expect(screen.getByRole("progressbar", { name: "5-hour window" }).getAttribute("aria-valuenow")).toBe("38");
    expect(screen.getByRole("progressbar", { name: "7-day window" }).getAttribute("aria-valuenow")).toBe("96");
    expect(screen.getByText("resets in 2h 10m")).toBeTruthy();
    expect(screen.getByText("15.4k")).toBeTruthy();
    expect(screen.getByText("12k in · 3.4k out")).toBeTruthy();
  });

  it("says so when the agent does not report plan usage, and still shows tokens", () => {
    render(<UsagePanel reportsPlanUsage={false} planUsage={[]} inputTokens={500} outputTokens={100} now={NOW} />);
    expect(screen.getByText("This agent does not report plan usage.")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText("600")).toBeTruthy();
  });

  it("shows nothing at all while there is nothing to show yet", () => {
    const { container } = render(<UsagePanel reportsPlanUsage planUsage={[]} inputTokens={0} outputTokens={0} now={NOW} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the plan windows alone when a turn reported them but no tokens", () => {
    render(<UsagePanel reportsPlanUsage planUsage={[{ name: "five_hour", utilization: 0.3 }]} inputTokens={0} outputTokens={0} now={NOW} />);
    expect(screen.getByRole("progressbar", { name: "5-hour window" })).toBeTruthy();
    expect(screen.queryByText("Session tokens")).toBeNull();
  });
});

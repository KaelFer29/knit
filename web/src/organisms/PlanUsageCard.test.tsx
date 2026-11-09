import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlanUsageCard } from "./PlanUsageCard";

const WINDOWS = [
  { label: "Current session", percent: 36, resets: "Nov 9, 3:10am (America/Santiago)" },
  { label: "Current week (all models)", percent: 50, resets: "Nov 12, 1am (America/Santiago)" },
];
const NOW = Date.parse("2026-11-09T10:00:00Z");

describe("PlanUsageCard", () => {
  it("draws one bar per plan window with its percentage and when it resets", () => {
    render(<PlanUsageCard windows={WINDOWS} checkedAt="2026-11-09T09:59:30Z" now={NOW} loading={false} onRefresh={() => {}} />);
    const session = screen.getByRole("meter", { name: "Current session" });
    expect(session.getAttribute("aria-valuenow")).toBe("36");
    expect(screen.getByText("36% used")).toBeTruthy();
    expect(screen.getByText("Resets Nov 12, 1am (America/Santiago)")).toBeTruthy();
    expect(screen.getByText(/updated just now/i)).toBeTruthy();
  });

  it("refreshes on request and says it is reading", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const { rerender } = render(<PlanUsageCard windows={WINDOWS} now={NOW} loading={false} onRefresh={onRefresh} />);
    await user.click(screen.getByRole("button", { name: "Refresh usage" }));
    expect(onRefresh).toHaveBeenCalledOnce();
    rerender(<PlanUsageCard windows={WINDOWS} now={NOW} loading onRefresh={onRefresh} />);
    expect((screen.getByRole("button", { name: "Refresh usage" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows why it has no numbers when the read failed", () => {
    render(<PlanUsageCard windows={[]} now={NOW} loading={false} error="Could not read the plan usage: timed out" onRefresh={() => {}} />);
    expect(screen.getByText(/timed out/)).toBeTruthy();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PlanDraftView } from "../sessions/plans";
import { PlanDrafts } from "./PlanDrafts";

const valid: PlanDraftView = {
  path: "/r/docs/plans/a.md",
  file: "a.md",
  modifiedAt: "x",
  name: "Add login",
  valid: true,
  issues: [],
  tasks: [{ id: "T1", title: "Form", branch: "feat/form" }],
  runs: [{ id: "run-12345678-zz", status: "passed", startedAt: "x" }],
};
const invalid: PlanDraftView = { ...valid, path: "/r/docs/plans/b.md", file: "b.md", name: "b.md", valid: false, issues: ["T1 has no goal", "<b>bad</b>"], tasks: [], runs: [] };

describe("PlanDrafts", () => {
  it("renders nothing without drafts", () => {
    const { container } = render(<PlanDrafts dir="docs/plans" plans={[]} onLaunch={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the model the planner chose for a task, and nothing for a task that has none", () => {
    const plan: PlanDraftView = { ...valid, tasks: [{ id: "T1", title: "Form", branch: "feat/form", model: "grok-4.7-high" }, { id: "T2", title: "Docs", branch: "docs/x" }] };
    render(<PlanDrafts dir="docs/plans" plans={[plan]} onLaunch={() => {}} />);
    const chip = screen.getByTitle("Model Cursor will use for T1");
    expect(chip.textContent).toBe("grok-4.7-high");
    expect(screen.queryByTitle("Model Cursor will use for T2")).toBeNull();
  });

  it("shows a valid plan with tasks and its runs, and launches only on click", async () => {
    const user = userEvent.setup();
    const onLaunch = vi.fn();
    render(<PlanDrafts dir="docs/plans" plans={[valid]} onLaunch={onLaunch} />);
    expect(screen.getByText("Valid")).toBeTruthy();
    expect(screen.getByText("feat/form")).toBeTruthy();
    expect(screen.getByRole("link", { name: /run-1234 · passed/ }).getAttribute("href")).toBe("?run=run-12345678-zz#/runs");
    expect(onLaunch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Send plan to the orchestrator" }));
    expect(onLaunch).toHaveBeenCalledWith(valid);
  });

  it("lists the issues of an invalid plan as text and disables sending it with the reason", () => {
    render(<PlanDrafts dir="docs/plans" plans={[invalid]} onLaunch={() => {}} />);
    expect(screen.getByText("Invalid · 2 issues")).toBeTruthy();
    expect(screen.getByText("<b>bad</b>")).toBeTruthy();
    expect(document.querySelector("b")).toBeNull();
    expect((screen.getByRole("button", { name: "Send plan to the orchestrator" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Fix 2 issues first.")).toBeTruthy();
  });

  it("disables launching while one is in flight and shows an error", () => {
    render(<PlanDrafts dir="docs/plans" plans={[valid]} launching={valid.path} error="Boom" onLaunch={() => {}} />);
    expect((screen.getByRole("button", { name: "Sending…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("Boom");
  });
});

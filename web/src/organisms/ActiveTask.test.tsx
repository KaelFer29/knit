import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { failedRun, retryingRun, runningRun, verifyingRun } from "../fixtures/boards";
import { ActiveTask } from "./ActiveTask";

const task = (board: typeof runningRun, id: string) => board.tasks.find((t) => t.taskId === id)!;

describe("ActiveTask", () => {
  it("shows the running task with its state and attempt", () => {
    render(<ActiveTask task={task(runningRun, "T3")} runStatus="running" />);
    expect(screen.getByText("Store events and make handling idempotent")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Attempt 1")).toBeTruthy();
    expect(screen.getByRole("list", { name: /stages/i }).querySelector("[aria-current='step']")?.textContent).toContain("Agent");
  });

  it("marks a retry and counts the attempt", () => {
    render(<ActiveTask task={task(retryingRun, "T2")} runStatus="running" />);
    expect(screen.getByText("Retrying")).toBeTruthy();
    expect(screen.getByText("Attempt 2")).toBeTruthy();
  });

  it("moves to the checks stage and names the command Knit runs", () => {
    render(<ActiveTask task={task(verifyingRun, "T2")} runStatus="running" />);
    expect(screen.getByText("Verifying")).toBeTruthy();
    expect(screen.getByRole("list", { name: /stages/i }).querySelector("[aria-current='step']")?.textContent).toContain("Checks");
    expect(screen.getByText("pnpm typecheck")).toBeTruthy();
  });

  it("shows why a task failed, and how many attempts it used", () => {
    render(<ActiveTask task={task(failedRun, "T2")} runStatus="failed" />);
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByText("check failed after 3 attempts: pnpm test (exit 1)")).toBeTruthy();
    expect(screen.getByText("3 attempts")).toBeTruthy();
  });

  it.each([
    ["passed", /all tasks delivered/i],
    ["failed", /run stopped/i],
    ["running", /waiting for the next task/i],
  ] as const)("says so when no task is open and the run is %s", (runStatus, text) => {
    render(<ActiveTask runStatus={runStatus} />);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it("is a disclosure with a detail slot", async () => {
    const user = userEvent.setup();
    render(<ActiveTask task={task(runningRun, "T3")} runStatus="running" renderDetail={(t) => <p>detail {t.kind === "task" ? t.taskId : ""}</p>} />);
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await user.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("detail T3")).toBeTruthy();
  });
});

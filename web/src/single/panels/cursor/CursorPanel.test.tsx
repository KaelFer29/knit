import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BoardModel } from "@board";
import { createRenderDetail } from "../../../containers/detailRenderer";
import { formatDuration, formatTokens } from "../../../flow/format";
import { deliveredRun, runningRun } from "../../../fixtures/boards";
import { fixtureDetailSource } from "../../../fixtures/detail";
import type { PanelProps } from "../registry";
import { CursorPanel } from "./CursorPanel";

const props = (board: BoardModel | undefined, source = board ? fixtureDetailSource(board) : undefined): PanelProps => ({
  board,
  runId: undefined,
  live: false,
  renderDetail: board && source ? createRenderDetail(board, source) : undefined,
  ...(source ? { detailSource: source } : {}),
  selectRun: vi.fn(),
});

describe("CursorPanel", () => {
  it("shows the active task first, open, and the other tasks as collapsed rows", () => {
    render(<CursorPanel {...props(runningRun)} />);
    const now = screen.getByRole("region", { name: "Active task" });
    expect(within(now).getByText("T3")).toBeTruthy();
    expect(within(now).getByText(runningRun.tasks[2]!.goal!)).toBeTruthy();
    const others = screen.getByRole("region", { name: "History" });
    expect(within(others).getAllByRole("button", { name: /^T\d/ })).toHaveLength(5);
    expect(within(others).queryByText(runningRun.tasks[0]!.goal!)).toBeNull();
  });

  it("opens the running attempt's timeline and shows the model the agent reported", async () => {
    render(<CursorPanel {...props(runningRun)} />);
    expect(await screen.findByText("composer-1")).toBeTruthy();
    expect(screen.getByText("Model")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Agent timeline" })).toBeTruthy();
  });

  it("expands another task, loading its changes only when they are opened", async () => {
    const source = fixtureDetailSource(runningRun);
    const spy = vi.spyOn(source, "diff");
    const user = userEvent.setup();
    render(<CursorPanel {...props(runningRun, source)} />);
    await user.click(screen.getByRole("button", { name: /^T1/ }));
    expect(screen.getByText(runningRun.tasks[0]!.goal!)).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Changes/ }));
    expect(spy).toHaveBeenCalledWith("T1");
  });

  it("shows the latest task when nothing is active", () => {
    render(<CursorPanel {...props(deliveredRun)} />);
    expect(screen.queryByRole("region", { name: "Active task" })).toBeNull();
    expect(screen.getByRole("region", { name: "Latest task" })).toBeTruthy();
  });

  it("shows in Files only what Cursor changed, grouped by task, and no repository explorer", async () => {
    const user = userEvent.setup();
    render(<CursorPanel {...props(runningRun)} />);
    expect(screen.getByRole("tab", { name: "Agent" }).getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("tab", { name: "Files" }));
    const groups = await screen.findAllByRole("region", { name: /^Changes of T\d/ });
    const started = runningRun.tasks.filter((t) => t.state !== "queued").map((t) => t.taskId);
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(started.map((id) => `Changes of ${id}`));
    expect(await within(groups[0]!).findByText("src/webhooks/signature.ts")).toBeTruthy();
    expect(screen.queryByRole("tree")).toBeNull();
    expect(screen.queryByRole("region", { name: "Active task" })).toBeNull();
  });

  it("says so when no task has changed anything yet", async () => {
    const user = userEvent.setup();
    const queued = { ...runningRun, tasks: runningRun.tasks.map((t) => ({ ...t, state: "queued" as const })), active: undefined };
    render(<CursorPanel {...props(queued as BoardModel)} />);
    await user.click(screen.getByRole("tab", { name: "Files" }));
    expect(await screen.findByText(/has not changed any file yet/i)).toBeTruthy();
  });

  it("shows a waiting state with what Cursor will show, not an empty box, when there is no run", () => {
    render(<CursorPanel {...props(undefined)} />);
    const idle = screen.getByRole("region", { name: "Cursor is idle" });
    expect(within(idle).getByRole("heading", { name: "Waiting for a task" })).toBeTruthy();
    expect(within(idle).getByText(/hands it one/i)).toBeTruthy();
    expect(screen.queryByText("No task to show yet.")).toBeNull();
  });

  it("summarizes the run: tasks delivered, attempts, tokens and agent time", () => {
    render(<CursorPanel {...props(runningRun)} />);
    const summary = within(screen.getByRole("region", { name: "Summary" }));
    const { totals } = runningRun;
    expect(summary.getByText("Tasks").nextSibling?.textContent).toBe(`${totals.tasks.delivered} of ${totals.tasks.total}`);
    expect(summary.getByText("Attempts").nextSibling?.textContent).toBe(String(totals.attempts));
    expect(summary.getByText("Tokens").nextSibling?.textContent).toBe(formatTokens(totals.tokens.cursor.input + totals.tokens.cursor.output));
    expect(summary.getByText("Agent time").nextSibling?.textContent).toBe(formatDuration(totals.agentMs));
  });

  it("says Cursor is working on the active task, and idle when everything is delivered", () => {
    const { unmount } = render(<CursorPanel {...props(runningRun)} />);
    expect(screen.getByRole("status", { name: "Cursor state" }).textContent).toMatch(/working on T3/i);
    unmount();
    render(<CursorPanel {...props(deliveredRun)} />);
    expect(screen.getByRole("status", { name: "Cursor state" }).textContent).toMatch(/idle/i);
  });
});

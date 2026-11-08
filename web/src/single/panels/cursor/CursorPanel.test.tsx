import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BoardModel } from "@board";
import { createRenderDetail } from "../../../containers/detailRenderer";
import { deliveredRun, runningRun } from "../../../fixtures/boards";
import { fixtureDetailSource } from "../../../fixtures/detail";
import type { PanelProps } from "../registry";
import { CursorPanel } from "./CursorPanel";

const props = (board: BoardModel | undefined, source = board ? fixtureDetailSource(board) : undefined): PanelProps => ({
  board,
  runId: undefined,
  live: false,
  renderDetail: board && source ? createRenderDetail(board, source) : undefined,
  selectRun: vi.fn(),
});

describe("CursorPanel", () => {
  it("shows the active task first, open, and the other tasks as collapsed rows", () => {
    render(<CursorPanel {...props(runningRun)} />);
    const now = screen.getByRole("region", { name: "Active task" });
    expect(within(now).getByText("T3")).toBeTruthy();
    expect(within(now).getByText(runningRun.tasks[2]!.goal!)).toBeTruthy();
    const others = screen.getByRole("region", { name: "Other tasks" });
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

  it("switches to the file explorer tab", async () => {
    const user = userEvent.setup();
    render(<CursorPanel {...props(runningRun)} />);
    expect(screen.getByRole("tab", { name: "Agent" }).getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("tab", { name: "Files" }));
    expect(await screen.findByRole("treeitem", { name: /README.md/ })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Active task" })).toBeNull();
  });

  it("says so when there is no run", () => {
    render(<CursorPanel {...props(undefined)} />);
    expect(screen.getByText("No task to show yet.")).toBeTruthy();
  });
});

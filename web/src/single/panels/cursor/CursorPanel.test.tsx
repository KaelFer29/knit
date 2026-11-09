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

  it("has only the Agent and Branches tabs: a task's changes live in its own detail", () => {
    render(<CursorPanel {...props(runningRun)} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Agent", "Branches"]);
    expect(screen.queryByRole("tab", { name: "Files" })).toBeNull();
  });

  it("collapses every task when nothing is active, the latest first, and opens none by itself", () => {
    render(<CursorPanel {...props(deliveredRun)} />);
    const rows = within(screen.getByRole("region", { name: "History" })).getAllByRole("button", { name: /^T\d/ });
    expect(rows[0]!.textContent).toContain(deliveredRun.tasks[deliveredRun.tasks.length - 1]!.taskId);
    expect(rows.every((r) => r.getAttribute("aria-expanded") === "false")).toBe(true);
  });

  it("pages a long history and searches it by task or title", async () => {
    const user = userEvent.setup();
    const many = { ...runningRun, tasks: Array.from({ length: 12 }, (_, i) => ({ ...runningRun.tasks[0]!, taskId: `T${i + 1}`, title: `Title ${i + 1}`, state: "delivered" as const })), active: undefined } as unknown as BoardModel;
    render(<CursorPanel {...props(many, fixtureDetailSource(runningRun))} />);
    const history = screen.getByRole("region", { name: "History" });
    expect(within(history).getAllByRole("button", { name: /^T\d/ })).toHaveLength(8);
    expect(screen.getByText("1–8 of 12 tasks")).toBeTruthy();
    await user.type(screen.getByRole("searchbox", { name: "Search tasks" }), "title 3");
    expect(within(history).getAllByRole("button", { name: /^T\d/ })).toHaveLength(1);
  });

  it("has a Branches tab that says it needs a real run when it shows sample data", async () => {
    const user = userEvent.setup();
    render(<CursorPanel {...props(runningRun)} />);
    await user.click(screen.getByRole("tab", { name: "Branches" }));
    expect(screen.getByText(/only available for a real run/i)).toBeTruthy();
  });

  it("lists the branches of a real run in the Branches tab", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ runId: "run-9", runStatus: "passed", base: "main", branches: [] }), { status: 200 })),
    );
    render(<CursorPanel {...props(runningRun)} runId="run-9" live />);
    await user.click(screen.getByRole("tab", { name: "Branches" }));
    expect(await screen.findByText(/no branches yet/i)).toBeTruthy();
    vi.unstubAllGlobals();
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

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_FIXTURES } from "../fixtures/boards";
import { RunControlBar } from "./RunControlBar";

const reply = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: "x", json: async () => body });
afterEach(() => vi.unstubAllGlobals());

const failedBoard = ALL_FIXTURES.failedRun;
const failedTask = failedBoard.tasks.find((t) => t.state === "failed")!;

describe("RunControlBar", () => {
  it("asks before aborting a running run, then posts the abort", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(202, { runId: "x", logPath: "/l" }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<RunControlBar board={{ ...ALL_FIXTURES.runningRun, runId: "r 1" }} />);
    await user.click(screen.getByRole("button", { name: "Abort" }));
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Abort run" }));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/r%201/abort");
    expect(fetchMock.mock.calls[0]![1].method).toBe("POST");
    expect((await screen.findByRole("status")).textContent).toContain("Abort requested");
  });

  it("offers resume and a retry per failed task on a failed run", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(202, { runId: "x", pid: 1, logPath: "/l" }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<RunControlBar board={failedBoard} />);
    expect(screen.queryByRole("button", { name: "Abort" })).toBeNull();
    await user.click(screen.getByRole("button", { name: `Retry ${failedTask.taskId}` }));
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/runs/${failedBoard.runId}/tasks/${failedTask.taskId}/retry`);
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(fetchMock.mock.calls[1]![0]).toBe(`/api/runs/${failedBoard.runId}/resume`);
  });

  it("shows the server's reason when a command is refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(409, { error: "Run is running" })));
    const user = userEvent.setup();
    render(<RunControlBar board={failedBoard} />);
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Run is running");
  });

  it("offers nothing for a run that passed", () => {
    render(<RunControlBar board={ALL_FIXTURES.deliveredRun} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

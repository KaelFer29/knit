import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DetailSource } from "../detail/types";
import { failedRun, legacyRun, runningRun } from "../fixtures/boards";
import { fixtureDetailSource } from "../fixtures/detail";
import { createRenderDetail } from "./detailRenderer";

const task = (board: typeof failedRun, id: string) => board.tasks.find((t) => t.taskId === id)!;

describe("task detail", () => {
  it("loads the timeline only when an attempt is opened", async () => {
    const source = { ...fixtureDetailSource(failedRun), timeline: vi.fn(async () => [{ id: 1, ts: "2026-11-03T09:01:00Z", kind: "message", payload: { text: "<b>hello</b>" } }]) };
    const user = userEvent.setup();
    render(<>{createRenderDetail(failedRun, source)({ kind: "task", taskId: "T2" })}</>);
    expect(source.timeline).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Attempt 1/ }));
    expect(await screen.findByText("<b>hello</b>")).toBeTruthy();
    expect(source.timeline).toHaveBeenCalledWith("T2", 1);
    expect(screen.getByText("Checks")).toBeTruthy();
  });

  it("shows the diff of a task that has code, loaded when opened, with the hunks as text", async () => {
    const source = fixtureDetailSource(failedRun);
    const spy = vi.spyOn(source, "diff");
    const user = userEvent.setup();
    render(<>{createRenderDetail(failedRun, source)({ kind: "task", taskId: "T1" })}</>);
    expect(spy).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Changes/ }));
    expect(await screen.findByText(/4 files/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /signature\.ts/ }));
    expect(screen.getByRole("table", { name: /Changes in src\/webhooks\/signature\.ts/ })).toBeTruthy();
    expect(screen.getByText(/timingSafeEqual/)).toBeTruthy();
  });

  it("shows the files an attempt touched, loaded when the attempt is opened", async () => {
    const source = fixtureDetailSource(failedRun);
    const spy = vi.spyOn(source, "activity");
    const user = userEvent.setup();
    render(<>{createRenderDetail(failedRun, source)({ kind: "task", taskId: "T2" })}</>);
    await user.click(screen.getByRole("button", { name: /Attempt 1/ }));
    expect(spy).toHaveBeenCalledWith("T2", 1);
    expect(await screen.findByRole("list", { name: "Files touched" })).toBeTruthy();
    expect(screen.getByText("src/webhooks/signature.test.ts")).toBeTruthy();
  });

  it("lists what the worktree changed, loaded when opened, and says when it cannot be read", async () => {
    const source = fixtureDetailSource(failedRun);
    const spy = vi.spyOn(source, "activity");
    const user = userEvent.setup();
    render(<>{createRenderDetail(failedRun, source)({ kind: "task", taskId: "T1" })}</>);
    expect(spy).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Worktree changes/ }));
    expect(spy).toHaveBeenCalledWith("T1");
    expect(await screen.findByRole("list", { name: "Worktree changes" })).toBeTruthy();
    expect(screen.getByText("src/webhooks/signature.ts")).toBeTruthy();
  });

  it("says that the worktree cannot be read when the server could not read it", async () => {
    const source: DetailSource = { ...fixtureDetailSource(failedRun), activity: async () => ({ touched: [], worktree: null }) };
    const user = userEvent.setup();
    render(<>{createRenderDetail(failedRun, source)({ kind: "task", taskId: "T1" })}</>);
    await user.click(screen.getByRole("button", { name: /Worktree changes/ }));
    expect(await screen.findByText("The worktree cannot be read.")).toBeTruthy();
  });

  it("shows the error when a load fails", async () => {
    const source: DetailSource = { ...fixtureDetailSource(failedRun), diff: async () => { throw new Error("The task's worktree no longer exists"); } };
    const user = userEvent.setup();
    render(<>{createRenderDetail(failedRun, source)({ kind: "task", taskId: "T1" })}</>);
    await user.click(screen.getByRole("button", { name: /Changes/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The task's worktree no longer exists"));
  });

  it("has no changes section for a task that never started", () => {
    render(<>{createRenderDetail(runningRun, fixtureDetailSource(runningRun))({ kind: "task", taskId: runningRun.queue[0]!.taskId })}</>);
    expect(screen.getByText("No attempts yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Changes/ })).toBeNull();
  });
});

describe("Knit detail", () => {
  it("shows verdicts and the feedback given for the next attempt", async () => {
    const user = userEvent.setup();
    render(<>{createRenderDetail(failedRun, fixtureDetailSource(failedRun))({ kind: "agent", id: "knit" })}</>);
    await user.click(screen.getByRole("button", { name: /T2 Verify the signature/ }));
    expect(screen.getAllByText("Feedback sent to the agent").length).toBe(2);
    expect(screen.getAllByText("Checks: pnpm test").length).toBeGreaterThan(0);
    expect(screen.getByText("Files outside the allowed list were changed")).toBeTruthy();
    expect(screen.getByText(/the task branch has 2 commits/)).toBeTruthy();
  });
});

describe("Claude detail", () => {
  it("shows the plan text and the specs", async () => {
    const user = userEvent.setup();
    render(<>{createRenderDetail(failedRun, fixtureDetailSource(failedRun))({ kind: "agent", id: "claude" })}</>);
    await user.click(screen.getByRole("button", { name: /^Plan/ }));
    expect(screen.getByText(/# Plan: add-billing-webhooks/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^Specs/ }));
    expect(screen.getAllByText("S1").length).toBeGreaterThan(0);
  });

  it("says so when the run stored no plan text", async () => {
    const user = userEvent.setup();
    render(<>{createRenderDetail(legacyRun, fixtureDetailSource(legacyRun))({ kind: "agent", id: "claude" })}</>);
    await user.click(screen.getByRole("button", { name: /^Plan/ }));
    expect(screen.getByText("This run did not store the plan text.")).toBeTruthy();
  });
});

describe("renderDetail", () => {
  it("has nothing for the builder block or an unknown task", () => {
    const render = createRenderDetail(failedRun, fixtureDetailSource(failedRun));
    expect(render({ kind: "agent", id: "cursor" })).toBeUndefined();
    expect(render({ kind: "task", taskId: "T99" })).toBeUndefined();
    expect(task(failedRun, "T2").attempts.length).toBeGreaterThan(0);
  });
});

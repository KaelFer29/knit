import { describe, expect, it } from "vitest";
import type { BranchState } from "../ports/branch-tools.js";
import { decideUndo, type UndoContext } from "./undo-rules.js";

const state = (over: Partial<BranchState> = {}): BranchState => ({
  exists: true,
  head: "bbbbbbb",
  historyIntact: true,
  ahead: [
    { sha: "b1", subject: "feat: add greeting" },
    { sha: "b2", subject: "test: cover greeting" },
  ],
  pushed: false,
  hasWorktree: true,
  dirty: false,
  ...over,
});

const ctx = (over: Partial<UndoContext> = {}): UndoContext => ({
  runStatus: "failed",
  mode: "revert",
  task: { taskId: "T1", branch: "feat/greeting", startSha: "aaaaaaa" },
  state: state(),
  dependents: [],
  ...over,
});

describe("decideUndo", () => {
  it("refuses while the run is running: its agent may be writing to that branch", () => {
    expect(decideUndo(ctx({ runStatus: "running" }))).toEqual({ ok: false, reason: "The run is still running. Abort it first." });
  });

  it("refuses a task that has not started, or whose branch is gone", () => {
    expect(decideUndo(ctx({ task: { taskId: "T1" } }))).toMatchObject({ ok: false, reason: "T1 has not started, so there is nothing to undo." });
    expect(decideUndo(ctx({ state: state({ exists: false, ahead: [] }) }))).toMatchObject({ ok: false, reason: expect.stringContaining("no longer exists") });
  });

  it("reverts with a new commit when the branch has commits, keeping the history, and says so", () => {
    const d = decideUndo(ctx({ mode: "revert" }));
    expect(d).toEqual({ ok: true, effects: expect.any(Array) });
    if (d.ok) expect(d.effects.join(" ")).toMatch(/adds one commit/i);
  });

  it("has nothing to revert or reset on a branch without commits and without uncommitted changes", () => {
    for (const mode of ["revert", "reset"] as const) {
      expect(decideUndo(ctx({ mode, state: state({ ahead: [] }) }))).toMatchObject({ ok: false, reason: expect.stringContaining("nothing to undo") });
    }
  });

  it("refuses to revert over uncommitted changes, so they are never mixed into the revert or lost", () => {
    expect(decideUndo(ctx({ mode: "revert", state: state({ dirty: true }) }))).toMatchObject({ ok: false, reason: expect.stringContaining("uncommitted") });
  });

  it("resets only when the history is intact, and lists the commits that leave the branch", () => {
    expect(decideUndo(ctx({ mode: "reset", state: state({ historyIntact: false }) }))).toMatchObject({ ok: false, reason: expect.stringContaining("rewritten") });
    const d = decideUndo(ctx({ mode: "reset" }));
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.effects.join(" ")).toContain("2 commits");
  });

  it("says the history was rewritten, not that there is nothing to undo, when the start is no longer on the branch", () => {
    for (const mode of ["revert", "reset"] as const) {
      const d = decideUndo(ctx({ mode, state: state({ historyIntact: false, ahead: [] }) }));
      expect(d).toMatchObject({ ok: false, reason: expect.stringContaining("rewritten") });
    }
    expect(decideUndo(ctx({ mode: "delete", state: state({ historyIntact: false, ahead: [] }) })).ok).toBe(true);
  });

  it("deletes a branch and its worktree, warning about the commits and that the pushed copy stays", () => {
    const d = decideUndo(ctx({ mode: "delete", state: state({ pushed: true }) }));
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.effects.join(" ")).toContain("feat/greeting");
      expect(d.effects.join(" ")).toMatch(/origin.*not touched/i);
    }
  });

  it("deletes a branch that has no commits too (a worktree left behind), without a commit warning", () => {
    const d = decideUndo(ctx({ mode: "delete", state: state({ ahead: [] }) }));
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.effects.join(" ")).not.toMatch(/commit(s)? (is|are) lost/i);
  });

  it("refuses to reset or delete a branch another task is stacked on, and names it", () => {
    const dependents = [{ taskId: "T2", branch: "feat/second" }];
    for (const mode of ["reset", "delete"] as const) {
      expect(decideUndo(ctx({ mode, dependents }))).toMatchObject({ ok: false, reason: expect.stringContaining("T2") });
    }
    expect(decideUndo(ctx({ mode: "revert", dependents })).ok).toBe(true);
  });
});

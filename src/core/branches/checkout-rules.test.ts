import { describe, expect, it } from "vitest";
import type { BranchState } from "../ports/branch-tools.js";
import { decideCheckout, type CheckoutContext } from "./checkout-rules.js";

const state = (over: Partial<BranchState> = {}): BranchState => ({
  exists: true,
  head: "bbb",
  historyIntact: true,
  ahead: [{ sha: "b1", subject: "docs: add prueba.md" }, { sha: "b2", subject: "docs: fix" }],
  pushed: false,
  hasWorktree: true,
  dirty: false,
  ...over,
});

const ctx = (over: Partial<CheckoutContext> = {}): CheckoutContext => ({
  runStatus: "passed",
  task: { taskId: "T1", branch: "docs/one", startSha: "aaa" },
  state: state(),
  baseBranch: "main",
  ...over,
});

describe("decideCheckout", () => {
  it("says what it will do: free the worktree, keep the branch, switch the repository, and how to go back to iterate", () => {
    const d = decideCheckout(ctx());
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.effects[0]).toMatch(/Removes the worktree of T1.*docs\/one and its 2 commits stay/);
    expect(d.effects.join(" ")).toMatch(/Switches your repository to docs\/one/);
    expect(d.effects.join(" ")).toMatch(/no uncommitted changes/i);
    expect(d.effects.join(" ")).toMatch(/git checkout main/);
  });

  it("does not talk about a worktree that is already gone", () => {
    const d = decideCheckout(ctx({ state: state({ hasWorktree: false }) }));
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.effects.join(" ")).not.toMatch(/Removes the worktree/);
  });

  it("does not name a branch to go back to when the run has none", () => {
    const d = decideCheckout(ctx({ baseBranch: undefined }));
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.effects.join(" ")).toMatch(/switch your repository back to another branch/i);
  });

  it("refuses while the run is running", () => {
    expect(decideCheckout(ctx({ runStatus: "running" }))).toEqual({ ok: false, reason: "The run is still running. Abort it first." });
  });

  it("refuses a task that has no branch, and a branch that is gone", () => {
    expect(decideCheckout(ctx({ task: { taskId: "T1" } }))).toMatchObject({ ok: false, reason: expect.stringContaining("no branch") });
    expect(decideCheckout(ctx({ state: state({ exists: false }) }))).toMatchObject({ ok: false, reason: expect.stringContaining("no longer exists") });
  });

  it("refuses when the repository is already on the branch", () => {
    expect(decideCheckout(ctx({ state: state({ checkedOut: true, hasWorktree: false }) }))).toMatchObject({ ok: false, reason: expect.stringContaining("already on docs/one") });
  });

  it("refuses when the worktree has uncommitted changes: removing it would lose them", () => {
    expect(decideCheckout(ctx({ state: state({ dirty: true }) }))).toMatchObject({ ok: false, reason: expect.stringContaining("uncommitted changes") });
  });
});

import { describe, expect, it } from "vitest";
import type { BranchState } from "../ports/branch-tools.js";
import { describeBranches, type BranchTask } from "./overview.js";

const state = (over: Partial<BranchState> = {}): BranchState => ({
  exists: true,
  head: "h",
  historyIntact: true,
  ahead: [{ sha: "c1", subject: "feat: x" }],
  pushed: false,
  hasWorktree: true,
  dirty: false,
  ...over,
});

const t1: BranchTask = { taskId: "T1", title: "One", status: "passed", branch: "feat/one", startSha: "s1" };
const t2: BranchTask = { taskId: "T2", title: "Two", status: "passed", branch: "feat/two", startSha: "s2", dependsOn: "T1" };
const run = { status: "passed", base: "main@abcd1234" };

describe("describeBranches", () => {
  it("describes only the tasks that have a branch, in order, with their state and the decision for every action", () => {
    const t3: BranchTask = { taskId: "T3", title: "Three", status: "passed", branch: "feat/three", startSha: "s3" };
    const out = describeBranches(run, [t1, { taskId: "T0", title: "Not started", status: "pending" }, t3], () => state());
    expect(out.map((b) => b.taskId)).toEqual(["T1", "T3"]);
    expect(out[0]).toMatchObject({ taskId: "T1", branch: "feat/one", state: { exists: true }, undo: { revert: { ok: true }, reset: { ok: true }, delete: { ok: true } } });
  });

  it("holds reset and delete of a branch another task is stacked on, but not revert", () => {
    const [first, second] = describeBranches(run, [t1, t2], () => state());
    expect(first!.undo.revert.ok).toBe(true);
    expect(first!.undo.reset).toMatchObject({ ok: false, reason: expect.stringContaining("T2") });
    expect(first!.undo.delete).toMatchObject({ ok: false, reason: expect.stringContaining("T2") });
    expect(second!.undo.delete.ok).toBe(true);
  });

  it("does not count a stacked task whose branch is already gone as a dependent", () => {
    const [first] = describeBranches(run, [t1, t2], (task) => (task.taskId === "T2" ? state({ exists: false, ahead: [] }) : state()));
    expect(first!.undo.delete.ok).toBe(true);
  });

  it("targets the run's base for a plain task and the parent's branch for a stacked one, once the parent is on origin", () => {
    const unpushed = describeBranches(run, [t1, t2], () => state({ pushed: false }));
    expect(unpushed[0]!.pr).toMatchObject({ ok: true, base: "main" });
    expect(unpushed[1]!.pr).toMatchObject({ ok: false, reason: expect.stringContaining("T1") });
    const pushed = describeBranches(run, [t1, t2], (task) => state({ pushed: task.taskId === "T1" }));
    expect(pushed[1]!.pr).toMatchObject({ ok: true, base: "feat/one" });
  });

  it("carries the pull request a task already has and offers no other", () => {
    const [b] = describeBranches(run, [{ ...t1, prUrl: "https://example.test/pull/7" }], () => state());
    expect(b!.prUrl).toBe("https://example.test/pull/7");
    expect(b!.pr.ok).toBe(false);
  });

  it("holds everything while the run is running", () => {
    const [b] = describeBranches({ ...run, status: "running" }, [t1], () => state());
    expect(b!.undo.delete).toEqual({ ok: false, reason: "The run is still running. Abort it first." });
    expect(b!.pr.ok).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { BranchState } from "../ports/branch-tools.js";
import { decidePr, type PrContext } from "./pr-rules.js";

const state = (over: Partial<BranchState> = {}): BranchState => ({
  exists: true,
  head: "bbb",
  historyIntact: true,
  ahead: [{ sha: "b1", subject: "docs: add prueba.md" }],
  pushed: false,
  hasWorktree: true,
  dirty: false,
  ...over,
});

const ctx = (over: Partial<PrContext> = {}): PrContext => ({
  runStatus: "passed",
  runBase: "main@a1b2c3d4",
  task: { taskId: "T1", branch: "docs/one", status: "passed" },
  tasks: [{ taskId: "T1", branch: "docs/one" }],
  state: state(),
  parentState: undefined,
  ...over,
});

describe("decidePr", () => {
  it("allows a passed task with commits and says where it will go", () => {
    expect(decidePr(ctx())).toEqual({ ok: true, base: "main", head: "docs/one", options: ["main"], effects: expect.any(Array) });
    const d = decidePr(ctx());
    if (d.ok) expect(d.effects.join(" ")).toMatch(/pushes docs\/one to origin.*pull request.*main/is);
  });

  it("says the branch is already on origin when it is, so nobody expects a first push", () => {
    const d = decidePr(ctx({ state: state({ pushed: true }) }));
    expect(d).toMatchObject({ ok: true });
    if (d.ok) expect(d.effects[0]).toMatch(/already on origin.*never forced/i);
  });

  it("refuses while the run is running", () => {
    expect(decidePr(ctx({ runStatus: "running" }))).toMatchObject({ ok: false, reason: "The run is still running. Abort it first." });
  });

  it("only opens pull requests for work that passed its checks", () => {
    expect(decidePr(ctx({ task: { taskId: "T1", branch: "docs/one", status: "failed" } }))).toMatchObject({ ok: false, reason: expect.stringContaining("passed") });
  });

  it("refuses a task without a branch, a branch that is gone, and a branch without commits", () => {
    expect(decidePr(ctx({ task: { taskId: "T1", status: "passed" } }))).toMatchObject({ ok: false, reason: expect.stringContaining("no branch") });
    expect(decidePr(ctx({ state: state({ exists: false, ahead: [] }) }))).toMatchObject({ ok: false, reason: expect.stringContaining("no longer exists") });
    expect(decidePr(ctx({ state: state({ ahead: [] }) }))).toMatchObject({ ok: false, reason: expect.stringContaining("no commits") });
  });

  it("does not open a second pull request for a task that already has one, and shows it", () => {
    expect(decidePr(ctx({ task: { taskId: "T1", branch: "docs/one", status: "passed", prUrl: "https://example.test/pull/7" } }))).toMatchObject({
      ok: false,
      reason: expect.stringContaining("https://example.test/pull/7"),
    });
  });

  it("stacks on the parent: the parent's branch must be on origin first, because GitHub needs the base there", () => {
    const stacked = ctx({
      task: { taskId: "T2", branch: "docs/two", dependsOn: "T1", status: "passed" },
      tasks: [{ taskId: "T1", branch: "docs/one" }, { taskId: "T2", branch: "docs/two", dependsOn: "T1" }],
    });
    expect(decidePr({ ...stacked, parentState: state({ pushed: false }) })).toMatchObject({ ok: false, reason: expect.stringContaining("T1") });
    expect(decidePr({ ...stacked, parentState: state({ pushed: true }) })).toMatchObject({ ok: true, base: "docs/one" });
  });

  it("refuses when the run's base is not a branch", () => {
    expect(decidePr(ctx({ runBase: "HEAD@a1b2c3d4" }))).toMatchObject({ ok: false, reason: expect.stringContaining("not a branch") });
  });

  it("refuses to open a pull request over uncommitted work it would leave out, and says so", () => {
    expect(decidePr(ctx({ state: state({ dirty: true }) }))).toMatchObject({ ok: false, reason: expect.stringContaining("uncommitted") });
  });

  describe("choosing where the pull request goes", () => {
    const stacked = ctx({
      task: { taskId: "T2", branch: "docs/two", dependsOn: "T1", status: "passed" },
      tasks: [{ taskId: "T1", branch: "docs/one" }, { taskId: "T2", branch: "docs/two", dependsOn: "T1" }, { taskId: "T3", branch: "docs/three" }],
      parentState: state({ pushed: true }),
    });

    it("recommends the parent's branch for a stacked task and offers the run's base and the other branches", () => {
      expect(decidePr(stacked)).toMatchObject({ ok: true, base: "docs/one", options: ["docs/one", "main", "docs/three"] });
    });

    it("recommends the run's base for a plain task and offers the other tasks' branches, never its own", () => {
      const plain = ctx({ tasks: [{ taskId: "T1", branch: "docs/one" }, { taskId: "T2", branch: "docs/two" }] });
      expect(decidePr(plain)).toMatchObject({ ok: true, base: "main", options: ["main", "docs/two"] });
    });

    it("targets the branch asked for and says so in what it will do", () => {
      const d = decidePr({ ...stacked, requestedBase: "main" });
      expect(d).toMatchObject({ ok: true, base: "main", head: "docs/two" });
      if (d.ok) expect(d.effects.join(" ")).toMatch(/pull request from docs\/two into main/);
    });

    it("does not need the parent on origin when the pull request goes elsewhere", () => {
      expect(decidePr({ ...stacked, parentState: state({ pushed: false }), requestedBase: "main" })).toMatchObject({ ok: true, base: "main" });
      expect(decidePr({ ...stacked, parentState: state({ pushed: false }), requestedBase: "docs/one" })).toMatchObject({ ok: false, reason: expect.stringContaining("T1") });
    });

    it("accepts a branch that is not in the suggestions, as long as it is a branch name", () => {
      expect(decidePr(ctx({ requestedBase: "release/1.2" }))).toMatchObject({ ok: true, base: "release/1.2" });
    });

    it("refuses what is not a branch name, and a pull request into its own branch", () => {
      for (const bad of ["", "  ", "--force", "-x", "a b", "a..b", "a@{1}", "main\nx", "x".repeat(201), "/a", "a/", "a.lock"]) {
        expect(decidePr(ctx({ requestedBase: bad }))).toMatchObject({ ok: false, reason: expect.stringContaining("branch name") });
      }
      expect(decidePr(ctx({ requestedBase: "docs/one" }))).toMatchObject({ ok: false, reason: expect.stringContaining("its own branch") });
    });
  });

  describe("a task that already has a pull request", () => {
    const withPr = (prior?: PrContext["prior"]) =>
      ctx({ task: { taskId: "T1", branch: "docs/one", status: "passed", prUrl: "https://example.test/pull/7" }, ...(prior ? { prior } : {}) });

    it("opens another one when the earlier was merged and the branch has new commits since, and says how many", () => {
      const d = decidePr(withPr({ state: "merged", newCommits: 2 }));
      expect(d).toMatchObject({ ok: true, base: "main", head: "docs/one" });
      if (d.ok) expect(d.effects.join(" ")).toMatch(/2 new commits since the previous pull request, which was merged/);
    });

    it("does the same for a closed one, and speaks of a single commit in the singular", () => {
      const d = decidePr(withPr({ state: "closed", newCommits: 1 }));
      expect(d.ok).toBe(true);
      if (d.ok) expect(d.effects.join(" ")).toMatch(/1 new commit since the previous pull request, which was closed/);
    });

    it("still refuses while the earlier one is open, and when nothing is new or it is not known", () => {
      for (const prior of [{ state: "open" as const, newCommits: 3 }, { state: "merged" as const, newCommits: 0 }, { state: "merged" as const }, undefined]) {
        expect(decidePr(withPr(prior)), JSON.stringify(prior)).toMatchObject({ ok: false, reason: expect.stringContaining("already has a pull request") });
      }
    });
  });
});


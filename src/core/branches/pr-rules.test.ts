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
    expect(decidePr(ctx())).toEqual({ ok: true, base: "main", head: "docs/one", effects: expect.any(Array) });
    const d = decidePr(ctx());
    if (d.ok) expect(d.effects.join(" ")).toMatch(/pushes docs\/one to origin.*pull request.*main/is);
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
});

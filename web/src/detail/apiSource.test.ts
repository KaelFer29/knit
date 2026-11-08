import { describe, expect, it, vi } from "vitest";
import { createApiDetailSource, type SnapshotParts } from "./apiSource";

const snapshot: SnapshotParts = {
  run: { id: "run 1", planText: "# Plan: x" },
  attempts: [{ taskId: "T1", attempt: 1, resultText: "I changed a.ts" }],
  events: [
    { type: "attempt.finished", taskId: "T1", attempt: 1, payload: { passed: false, gitProblems: ["extra commit", 3] } },
    { type: "attempt.finished", taskId: "T2", attempt: 1, payload: { passed: true } },
  ],
};

describe("createApiDetailSource", () => {
  it("reads notes and the plan from the snapshot", () => {
    const source = createApiDetailSource(snapshot, vi.fn());
    expect(source.planText).toBe("# Plan: x");
    expect(source.attemptNotes("T1", 1)).toEqual({ output: "I changed a.ts", gitProblems: ["extra commit"] });
    expect(source.attemptNotes("T2", 1)).toEqual({ gitProblems: [] });
    expect(source.attemptNotes("T9", 0)).toEqual({ gitProblems: [] });
  });

  it("has no plan text when the run stored none", () => {
    expect(createApiDetailSource({ ...snapshot, run: { id: "r" } }, vi.fn()).planText).toBeUndefined();
  });

  it("fetches the timeline and the diff lazily, with encoded paths", async () => {
    const fetcher = vi.fn(async (path: string) => (path.endsWith("/diff") ? { startSha: "a", files: [], moreFiles: false } : { events: [{ id: 1, ts: "t", kind: "message" }] }));
    const source = createApiDetailSource(snapshot, fetcher as never);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await source.timeline("T1", 2)).toEqual([{ id: 1, ts: "t", kind: "message" }]);
    expect(fetcher).toHaveBeenLastCalledWith("/api/runs/run%201/tasks/T1/attempts/2/timeline");
    expect((await source.diff("T1")).files).toEqual([]);
    expect(fetcher).toHaveBeenLastCalledWith("/api/runs/run%201/tasks/T1/diff");
  });

  it("fetches the files of one attempt, or of the whole task with its worktree, lazily", async () => {
    const fetcher = vi.fn(async (path: string) => ({ runId: "run 1", taskId: "T1", touched: ["a.ts"], worktree: null }));
    const source = createApiDetailSource(snapshot, fetcher as never);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await source.activity("T1", 2)).toEqual({ runId: "run 1", taskId: "T1", touched: ["a.ts"], worktree: null });
    expect(fetcher).toHaveBeenLastCalledWith("/api/runs/run%201/tasks/T1/activity?attempt=2");
    await source.activity("T1");
    expect(fetcher).toHaveBeenLastCalledWith("/api/runs/run%201/tasks/T1/activity");
  });
});

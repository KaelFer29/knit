import { afterEach, describe, expect, it } from "vitest";
import type { RunReader, RunSnapshot } from "../../core/ports/run-reader.js";
import { TaskDiffUnavailableError, type TaskDiff, type TaskDiffRequest } from "../../core/ports/task-diff.js";
import type { TaskRecord } from "../../core/ports/run-store.js";
import { startServer, type RunningServer } from "../server.js";

const TOKEN = "t".repeat(16);

function task(init: Partial<TaskRecord> & { taskId: string }): TaskRecord {
  return { runId: "r1", title: init.taskId, status: "passed", ...init };
}

function readerOf(tasks: TaskRecord[]): RunReader {
  const snapshot = {
    run: { id: "r1", planName: "p", planPath: "p.md", repo: "/r", base: "main", startedAt: "2026-01-01T00:00:00Z", status: "passed" },
    tasks,
    attempts: [],
    events: [],
    lastEventId: 0,
    lastAgentEventId: 0,
  } as RunSnapshot;
  return {
    listRuns: () => [],
    getRunSnapshot: (id) => (id === "r1" ? snapshot : undefined),
    getRun: (id) => (id === "r1" ? snapshot.run : undefined),
    getLatestAgentEvents: () => [],
    getEventsAfter: () => [],
    getAgentEventsAfter: () => [],
    close: () => undefined,
  };
}

let server: RunningServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function get(path: string, taskDiff: TaskDiff | undefined, tasks: TaskRecord[]): Promise<{ status: number; body: any }> {
  server = await startServer({ reader: readerOf(tasks), port: 0, token: TOKEN, ...(taskDiff ? { taskDiff } : {}) });
  const res = await fetch(`http://127.0.0.1:${server.port}${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  return { status: res.status, body: await res.json() };
}

const PASSED = task({ taskId: "T1", worktree: "/wt/t1", startSha: "abc1234", commitSha: "def5678" });

describe("GET /api/runs/:id/tasks/:task/diff", () => {
  it("reads the diff from the start commit to the task commit in its worktree", async () => {
    const seen: TaskDiffRequest[] = [];
    const taskDiff: TaskDiff = {
      diff: (req) => {
        seen.push(req);
        return { files: [{ path: "a.ts", status: "added", binary: false, additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+x\n" }], moreFiles: false };
      },
    };
    const { status, body } = await get("/api/runs/r1/tasks/T1/diff", taskDiff, [PASSED]);
    expect(status).toBe(200);
    expect(seen).toEqual([{ worktree: "/wt/t1", startSha: "abc1234", commitSha: "def5678" }]);
    expect(body).toEqual({
      runId: "r1",
      taskId: "T1",
      startSha: "abc1234",
      commitSha: "def5678",
      files: [{ path: "a.ts", status: "added", binary: false, additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+x\n" }],
      moreFiles: false,
    });
  });

  it("leaves the commit out while the task has none", async () => {
    const seen: TaskDiffRequest[] = [];
    const taskDiff: TaskDiff = { diff: (req) => (seen.push(req), { files: [], moreFiles: false }) };
    const open = task({ taskId: "T1", status: "running", worktree: "/wt/t1", startSha: "abc1234" });
    const { status, body } = await get("/api/runs/r1/tasks/T1/diff", taskDiff, [open]);
    expect(status).toBe(200);
    expect(seen).toEqual([{ worktree: "/wt/t1", startSha: "abc1234" }]);
    expect(body).not.toHaveProperty("commitSha");
  });

  it("answers 404 for an unknown run, an unknown task and a task that has not started", async () => {
    const taskDiff: TaskDiff = { diff: () => ({ files: [], moreFiles: false }) };
    expect((await get("/api/runs/nope/tasks/T1/diff", taskDiff, [PASSED])).status).toBe(404);
    expect((await get("/api/runs/r1/tasks/T9/diff", taskDiff, [PASSED])).status).toBe(404);
    expect((await get("/api/runs/r1/tasks/T2/diff", taskDiff, [task({ taskId: "T2", status: "pending" })])).status).toBe(404);
  });

  it("answers 404 with the reason when the worktree is gone", async () => {
    const taskDiff: TaskDiff = {
      diff: () => {
        throw new TaskDiffUnavailableError("The task's worktree no longer exists");
      },
    };
    const { status, body } = await get("/api/runs/r1/tasks/T1/diff", taskDiff, [PASSED]);
    expect(status).toBe(404);
    expect(body.error).toBe("The task's worktree no longer exists");
  });

  it("answers 503 on a server without the port and still needs the token", async () => {
    expect((await get("/api/runs/r1/tasks/T1/diff", undefined, [PASSED])).status).toBe(503);
    const res = await fetch(`http://127.0.0.1:${server!.port}/api/runs/r1/tasks/T1/diff`);
    expect(res.status).toBe(401);
  });
});

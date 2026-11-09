import { TaskDiffUnavailableError } from "../../core/ports/task-diff.js";
import { HttpError, sendJson } from "../http.js";
import type { RouteModule } from "../types.js";
import { requireSnapshot } from "./runs.js";

/** What a task changed: the diff from its start commit to its commit in its worktree (to the worktree's content while it has no commit). */
export const diffRoutes: RouteModule = ({ reader, taskDiff }) => [
  {
    method: "GET",
    pattern: "/api/runs/:id/tasks/:task/diff",
    handler: ({ res, params }) => {
      const snapshot = requireSnapshot(reader, params.id!);
      const taskId = params.task!;
      const task = snapshot.tasks.find((t) => t.taskId === taskId);
      if (!task) throw new HttpError(404, `Task not found: ${taskId}`);
      if (!taskDiff) throw new HttpError(503, "Task diffs are not available on this server");
      if (!task.startSha || !task.worktree) throw new HttpError(404, `Task ${taskId} has not started yet, so it has no diff`);
      try {
        const result = taskDiff.diff({
          worktree: task.worktree,
          startSha: task.startSha,
          ...(task.commitSha ? { commitSha: task.commitSha } : {}),
        });
        sendJson(res, 200, {
          runId: snapshot.run.id,
          taskId,
          startSha: task.startSha,
          ...(task.commitSha ? { commitSha: task.commitSha } : {}),
          ...result,
        });
      } catch (err) {
        if (err instanceof TaskDiffUnavailableError) throw new HttpError(404, err.message);
        throw err;
      }
    },
  },
];

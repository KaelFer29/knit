import { FileActivityUnavailableError } from "../../core/ports/file-activity.js";
import { touchedPaths } from "../../core/timeline/file-activity.js";
import { HttpError, sendJson } from "../http.js";
import type { RouteModule } from "../types.js";
import { requireSnapshot } from "./runs.js";

/**
 * Which files a task touched, read from the tool calls of its agent timeline (for one attempt when `?attempt=` is
 * given). Without an attempt it also lists what the task's worktree has changed right now, from git status.
 */
export const activityRoutes: RouteModule = ({ reader, fileActivity }) => [
  {
    method: "GET",
    pattern: "/api/runs/:id/tasks/:task/activity",
    handler: ({ res, params, url }) => {
      const snapshot = requireSnapshot(reader, params.id!);
      const taskId = params.task!;
      const task = snapshot.tasks.find((t) => t.taskId === taskId);
      if (!task) throw new HttpError(404, `Task not found: ${taskId}`);

      const rawAttempt = url.searchParams.get("attempt");
      if (rawAttempt !== null && !/^\d+$/.test(rawAttempt)) throw new HttpError(400, "attempt must be a non-negative integer");
      const attempt = rawAttempt === null ? undefined : Number(rawAttempt);

      const entries = reader.getAgentEventsAfter(snapshot.run.id, 0, {
        taskId,
        ...(attempt === undefined ? {} : { attempt }),
      });
      const touched = touchedPaths(entries, task.worktree);

      if (attempt !== undefined) {
        sendJson(res, 200, { runId: snapshot.run.id, taskId, attempt, touched });
        return;
      }
      let worktree: { paths: string[]; moreFiles: boolean } | null = null;
      if (fileActivity && task.worktree) {
        try {
          worktree = fileActivity.worktreeChanges(task.worktree);
        } catch (err) {
          if (!(err instanceof FileActivityUnavailableError)) throw err;
        }
      }
      sendJson(res, 200, { runId: snapshot.run.id, taskId, touched, worktree });
    },
  },
];

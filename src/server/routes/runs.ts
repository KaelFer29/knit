import { buildBoard } from "../../core/board/index.js";
import type { RunReader, RunSnapshot } from "../../core/ports/run-reader.js";
import { HttpError, sendJson } from "../http.js";
import type { RouteModule } from "../types.js";

/** The snapshot of a run, or a 404. */
export function requireSnapshot(reader: RunReader, runId: string): RunSnapshot {
  const snapshot = reader.getRunSnapshot(runId);
  if (!snapshot) throw new HttpError(404, `Run not found: ${runId}`);
  return snapshot;
}

/** Newest timeline entries read for the live line: it only shows the last one. */
const LIVE_WINDOW = 20;

/** Latest `attempt.started` of the task that is running, to read its timeline for the board's live line. */
function openAttemptWindow(snapshot: RunSnapshot): { taskId: string; attempt: number } | undefined {
  if (snapshot.run.status !== "running") return undefined;
  const task = snapshot.tasks.find((t) => t.status === "running");
  if (!task) return undefined;
  const started = snapshot.events.filter((e) => e.type === "attempt.started" && e.taskId === task.taskId && e.attempt !== undefined);
  const last = started.at(-1);
  return last?.attempt === undefined ? undefined : { taskId: task.taskId, attempt: last.attempt };
}

/** Read routes for runs: list, snapshot with its board, and the timeline of one attempt. */
export const runsRoutes: RouteModule = ({ reader, now }) => [
  {
    method: "GET",
    pattern: "/api/runs",
    handler: ({ res }) => sendJson(res, 200, { runs: reader.listRuns() }),
  },
  {
    method: "GET",
    pattern: "/api/runs/:id",
    handler: ({ res, params }) => {
      const snapshot = requireSnapshot(reader, params.id!);
      const window = openAttemptWindow(snapshot);
      const agentEvents = window ? reader.getLatestAgentEvents(snapshot.run.id, LIVE_WINDOW, window) : [];
      const board = buildBoard({
        run: snapshot.run,
        tasks: snapshot.tasks,
        attempts: snapshot.attempts,
        events: snapshot.events,
        agentEvents,
        nowMs: now(),
      });
      sendJson(res, 200, { ...snapshot, board });
    },
  },
  {
    method: "GET",
    pattern: "/api/runs/:id/tasks/:task/attempts/:n/timeline",
    handler: ({ res, params }) => {
      const snapshot = requireSnapshot(reader, params.id!);
      const taskId = params.task!;
      if (!snapshot.tasks.some((t) => t.taskId === taskId)) throw new HttpError(404, `Task not found: ${taskId}`);
      if (!/^\d+$/.test(params.n!)) throw new HttpError(400, "Attempt must be a non-negative integer");
      const attempt = Number(params.n);
      const events = reader.getAgentEventsAfter(snapshot.run.id, 0, { taskId, attempt });
      sendJson(res, 200, { runId: snapshot.run.id, taskId, attempt, events });
    },
  },
];

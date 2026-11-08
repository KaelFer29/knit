import { PLAN_DIR } from "../../core/ports/plan-drafts.js";
import { HttpError, sendJson } from "../http.js";
import type { RouteModule } from "../types.js";

/**
 * Draft plans of a session (S15, D7). The session's directory is read from the session record, never from the request.
 * Each draft carries its validation result and the runs started from that file; the run is thereby linked to the
 * session whose directory holds the plan. Launching is the existing `POST /api/runs`: nothing here starts a run.
 */
export const plansRoutes: RouteModule = ({ reader, plans, control }) => [
  {
    method: "GET",
    pattern: "/api/sessions/:id/plans",
    handler: ({ res, params }) => {
      const sessions = control?.sessions;
      if (!sessions || !plans) throw new HttpError(503, "Plan detection is not available on this server");
      const session = sessions.reader.getSession(params.id!);
      if (!session) throw new HttpError(404, `Session not found: ${params.id}`);
      const runs = reader.listRuns().map((r) => r.run);
      const drafts = plans.list(session.cwd).map((draft) => ({
        ...draft,
        runs: runs.filter((run) => run.planPath === draft.path).map((run) => ({ id: run.id, status: run.status, startedAt: run.startedAt })),
      }));
      sendJson(res, 200, { dir: PLAN_DIR, plans: drafts });
    },
  },
];

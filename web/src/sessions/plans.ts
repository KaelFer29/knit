import { apiGet, apiPost } from "../api/client";

/** Shapes of `GET /api/sessions/:id/plans` (see `docs/web-interface.md#sessions`). */
export interface PlanRun {
  id: string;
  status: string;
  startedAt: string;
}

export interface PlanTask {
  id: string;
  title: string;
  branch: string;
  dependsOn?: string;
}

export interface PlanDraftView {
  path: string;
  file: string;
  modifiedAt: string;
  name: string;
  valid: boolean;
  issues: string[];
  tasks: PlanTask[];
  runs: PlanRun[];
}

export interface PlanListing {
  dir: string;
  plans: PlanDraftView[];
}

export function fetchPlans(sessionId: string): Promise<PlanListing> {
  return apiGet<PlanListing>(`/api/sessions/${encodeURIComponent(sessionId)}/plans`);
}

/** Starts a run of the plan through the run-control route; the answer carries the new run's id. */
export async function launchPlan(planPath: string): Promise<string> {
  return (await apiPost<{ runId: string }>("/api/runs", { planPath })).runId;
}

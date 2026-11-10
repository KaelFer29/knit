import { apiGet, apiPost } from "../api/client";
import type { RunListItem, Started } from "./types";

const enc = encodeURIComponent;

/** What a page of runs is asked for; the server does the paging, the search and the filtering. */
export interface RunsQuery {
  limit: number;
  offset: number;
  q?: string;
  status?: RunListItem["run"]["status"];
}

export interface RunsPage {
  runs: RunListItem[];
  /** How many runs match in all, not just on this page. */
  total: number;
}

export async function fetchRunsPage(query: RunsQuery): Promise<RunsPage> {
  const params = new URLSearchParams({ limit: String(query.limit), offset: String(query.offset) });
  if (query.q) params.set("q", query.q);
  if (query.status) params.set("status", query.status);
  const body = await apiGet<{ runs: RunListItem[]; total?: number }>(`/api/runs?${params}`);
  return { runs: body.runs, total: body.total ?? body.runs.length };
}
export const abortRun = (runId: string): Promise<Started> => apiPost<Started>(`/api/runs/${enc(runId)}/abort`, {});
export const resumeRun = (runId: string): Promise<Started> => apiPost<Started>(`/api/runs/${enc(runId)}/resume`, {});
export const retryTask = (runId: string, taskId: string): Promise<Started> => apiPost<Started>(`/api/runs/${enc(runId)}/tasks/${enc(taskId)}/retry`, {});

/** What the follow-up route answers (202): the command is running and has recorded that it started. */
export interface FollowupStarted {
  runId: string;
  taskId: string;
  pid?: number;
  logPath: string;
}

/** Continues the Cursor chat of a delivered task on its own branch with this instruction; the orchestrator verifies the result again. */
export const sendFollowup = (runId: string, taskId: string, prompt: string): Promise<FollowupStarted> => apiPost<FollowupStarted>(`/api/runs/${enc(runId)}/tasks/${enc(taskId)}/followup`, { prompt });


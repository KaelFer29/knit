import { apiGet, apiPost } from "../api/client";
import type { RunListItem, Started } from "./types";

const enc = encodeURIComponent;

export const fetchRuns = async (): Promise<RunListItem[]> => (await apiGet<{ runs: RunListItem[] }>("/api/runs")).runs;
export const abortRun = (runId: string): Promise<Started> => apiPost<Started>(`/api/runs/${enc(runId)}/abort`, {});
export const resumeRun = (runId: string): Promise<Started> => apiPost<Started>(`/api/runs/${enc(runId)}/resume`, {});
export const retryTask = (runId: string, taskId: string): Promise<Started> => apiPost<Started>(`/api/runs/${enc(runId)}/tasks/${enc(taskId)}/retry`, {});

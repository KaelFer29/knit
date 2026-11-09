import { apiGet, apiPost } from "../api/client";
import type { BranchListing, PrDraft, PrResult, UndoMode, UndoResult } from "./types";

const base = (runId: string, taskId: string): string => `/api/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}`;

export const fetchBranches = (runId: string): Promise<BranchListing> => apiGet<BranchListing>(`/api/runs/${encodeURIComponent(runId)}/branches`);

/** Undoes what a task did on its branch. `confirm` is always true: the server refuses an undo that was not asked for explicitly. */
export const undoBranch = (runId: string, taskId: string, mode: UndoMode): Promise<UndoResult> => apiPost<UndoResult>(`${base(runId, taskId)}/undo`, { mode, confirm: true });

/** Has the cheap model write the title and body of the task's pull request. Nothing is pushed or opened. */
export const draftPullRequest = (runId: string, taskId: string): Promise<PrDraft> => apiPost<PrDraft>(`${base(runId, taskId)}/pr-draft`, {});

/** Pushes the branch and opens the pull request with exactly this text. */
export const openPullRequest = (runId: string, taskId: string, title: string, body: string): Promise<PrResult> => apiPost<PrResult>(`${base(runId, taskId)}/pr`, { title, body });

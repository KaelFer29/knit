import { apiGet, apiPost } from "../api/client";
import type { BranchListing, PrDraft, PrResult, UndoMode, UndoResult } from "./types";

const base = (runId: string, taskId: string): string => `/api/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}`;

export const fetchBranches = (runId: string): Promise<BranchListing> => apiGet<BranchListing>(`/api/runs/${encodeURIComponent(runId)}/branches`);

/** Undoes what a task did on its branch. `confirm` is always true: the server refuses an undo that was not asked for explicitly. */
export const undoBranch = (runId: string, taskId: string, mode: UndoMode): Promise<UndoResult> => apiPost<UndoResult>(`${base(runId, taskId)}/undo`, { mode, confirm: true });

/**
 * The title and body of the task's pull request. `template` builds them from the task itself (no model, no tokens);
 * `model` has the cheap model write them. Nothing is pushed or opened.
 */
export const draftPullRequest = (runId: string, taskId: string, how: "template" | "model"): Promise<PrDraft> =>
  apiPost<PrDraft>(`${base(runId, taskId)}/pr-draft`, how === "template" ? { template: true } : {});

/** Pushes the branch and opens the pull request with exactly this text. `into` is sent only when the person chose a branch other than the recommended one. */
export const openPullRequest = (runId: string, taskId: string, title: string, body: string, into?: string): Promise<PrResult> =>
  apiPost<PrResult>(`${base(runId, taskId)}/pr`, { title, body, ...(into === undefined ? {} : { base: into }) });

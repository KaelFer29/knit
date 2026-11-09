/** What `GET /api/runs/:id/branches` answers, and the answers of the branch actions. */

export type UndoMode = "revert" | "reset" | "delete";

export type Decision = { ok: true; effects: string[] } | { ok: false; reason: string };
export type PrDecision = { ok: true; base: string; head: string; /** Branches worth suggesting as a target, the recommended one first. */ options: string[]; effects: string[] } | { ok: false; reason: string };

export interface BranchState {
  exists: boolean;
  head?: string;
  historyIntact: boolean;
  ahead: { sha: string; subject: string }[];
  pushed: boolean;
  hasWorktree: boolean;
  dirty: boolean;
}

export interface BranchView {
  taskId: string;
  title: string;
  status: string;
  branch: string;
  startSha: string;
  prUrl?: string;
  state: BranchState;
  undo: Record<UndoMode, Decision>;
  pr: PrDecision;
}

export interface BranchListing {
  runId: string;
  runStatus: string;
  base: string;
  branches: BranchView[];
}

export interface UndoResult {
  ok: true;
  mode: UndoMode;
  branch: string;
  sha?: string;
}

export interface PrDraft {
  ok: true;
  title: string;
  body: string;
  model: string;
}

export interface PrResult {
  ok: true;
  url: string;
  base: string;
  head: string;
}

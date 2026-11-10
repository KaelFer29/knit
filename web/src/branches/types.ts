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
  /** The branch is the one the user's own repository is on. */
  checkedOut?: boolean;
}

export interface BranchView {
  taskId: string;
  title: string;
  status: string;
  branch: string;
  startSha: string;
  prUrl?: string;
  /** Read from GitHub when the list is built: absent when GitHub cannot be asked right now. */
  prState?: { state: "open" | "merged" | "closed"; base: string; /** Commits the branch got after that pull request ended; they are not in the base. */ newCommits?: number };
  state: BranchState;
  undo: Record<UndoMode, Decision>;
  /** Whether the user's repository can be switched to this branch to test it. */
  checkout: Decision;
  pr: PrDecision;
}

export interface BranchListing {
  runId: string;
  runStatus: string;
  base: string;
  branches: BranchView[];
  /** The task whose branch Knit switched the user's repository to, and the branch it was on before. */
  returnTo?: { taskId: string; branch: string };
}

export interface ReturnResult {
  ok: true;
  branch: string;
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

export interface CheckoutResult {
  ok: true;
  branch: string;
  freedWorktree: boolean;
}


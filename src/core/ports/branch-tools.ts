/** Port: looking at and editing the branch a task worked on. The read side is safe anywhere; the edit side only runs in the CLI. */

export type UndoMode = "revert" | "reset" | "delete";

export interface BranchRef {
  repo: string;
  branch: string;
  /** Commit the branch started from; everything after it is the agent's work. */
  startSha: string;
  /** The task worktree, when it still exists. */
  worktree?: string;
}

export interface BranchCommit {
  sha: string;
  subject: string;
}

export interface BranchState {
  exists: boolean;
  /** Where the branch points now. */
  head?: string;
  /** False when the start commit is no longer an ancestor of the branch: its history was rewritten. */
  historyIntact: boolean;
  /** Commits on the branch since the task started, oldest first. */
  ahead: BranchCommit[];
  /** A branch with this name is on `origin`. */
  pushed: boolean;
  hasWorktree: boolean;
  /** Uncommitted changes in the worktree. */
  dirty: boolean;
}

export interface BranchDiff {
  /** `git diff --stat` of what the branch changed since the start. */
  stat: string;
  /** The patch, cut to the byte limit that was asked for. */
  patch: string;
  truncated: boolean;
}

export interface BranchInspector {
  /** Never throws for a missing branch or worktree: it reports `exists: false`. */
  state(ref: BranchRef): BranchState;
  /** What the branch changed since the start; empty for a branch that does not exist. */
  diff(ref: BranchRef, maxBytes: number): BranchDiff;
}

export interface BranchEditor {
  /** Adds one commit that restores the start state, so nothing is lost; returns its sha. Needs a clean worktree. */
  revert(ref: BranchRef): { sha: string };
  /** Moves the branch back to the start commit. The commits after it leave the branch (the reflog still has them for a while). */
  reset(ref: BranchRef): void;
  /** A branch with this name is on `origin` right now (asks the remote). Throws when the remote cannot be reached. */
  onOrigin(repo: string, branch: string): boolean;
  /** Pushes the branch to `origin` with its upstream. Never forced: a remote branch that moved on is an error. */
  push(ref: BranchRef): void;
  /** Removes the worktree and deletes the branch, merged or not. A copy on `origin` is not touched. */
  remove(ref: BranchRef): void;
}

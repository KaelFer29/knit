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
  /** The branch is the one the user's own repository is on right now (not a task worktree). */
  checkedOut?: boolean;
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
  /** The branches `origin` has right now, sorted (asks the remote, so it is never stale). Throws without an origin or when it cannot be reached. */
  remoteBranches(repo: string): string[];
}

export interface BranchEditor {
  /** Adds one commit that restores the start state, so nothing is lost; returns its sha. Needs a clean worktree. */
  revert(ref: BranchRef): { sha: string };
  /** Moves the branch back to the start commit. The commits after it leave the branch (the reflog still has them for a while). */
  reset(ref: BranchRef): void;
  /**
   * Frees the task's worktree (never forced) and switches the user's repository to the branch, so it can be tested
   * there; the branch and its commits stay. Refuses when the repository or the worktree has uncommitted changes, or when
   * the branch is checked out somewhere else. Does nothing when the repository is already on the branch.
   */
  checkout(ref: BranchRef): { freedWorktree: boolean };
  /** A branch with this name is on `origin` right now (asks the remote). Throws when the remote cannot be reached. */
  onOrigin(repo: string, branch: string): boolean;
  /** Pushes the branch to `origin` with its upstream. Never forced: a remote branch that moved on is an error. */
  push(ref: BranchRef): void;
  /** Removes the worktree and deletes the branch, merged or not. A copy on `origin` is not touched. */
  remove(ref: BranchRef): void;
}

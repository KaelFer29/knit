/** Port: isolated git workspace per task. */
export interface TaskWorkspace {
  /** Absolute path of the task worktree (the agent's cwd). */
  path: string;
  branch: string;
  /** Commit the task branch started from; everything after it is the agent's work. */
  startSha: string;
}

export interface PrepareWorkspaceInput {
  repo: string;
  runId: string;
  taskId: string;
  /** Branch to create for the task (from the plan). */
  branch: string;
  /** Ref or commit the branch starts from. */
  startPoint: string;
}

export interface AttachWorkspaceInput {
  path: string;
  branch: string;
  startSha: string;
}

export interface BaseRef {
  sha: string;
  /** Local branch name of the base, when it is one (needed as the PR target). */
  branch?: string;
}

export interface CommitInfo {
  sha: string;
  subject: string;
  body: string;
}

export interface GitInspection {
  /** Branch currently checked out in the worktree ("HEAD" when detached). */
  branch: string;
  /** False when the starting commit is no longer an ancestor of HEAD (history rewritten). */
  historyIntact: boolean;
  /** Commits made since the start, oldest first. */
  commits: CommitInfo[];
  /** Paths with uncommitted changes (tracked or untracked, not ignored). */
  uncommitted: string[];
}

export interface Workspace {
  /** Resolves the plan's Base (or the repo's current HEAD) to a commit and, if any, a branch. */
  resolveBase(repo: string, base?: string): BaseRef;
  prepare(input: PrepareWorkspaceInput): TaskWorkspace;
  /** Re-opens a worktree kept from an earlier run; undefined when it no longer exists. */
  attach(input: AttachWorkspaceInput): TaskWorkspace | undefined;
  /** Paths that differ from the start commit: committed, uncommitted and untracked. */
  changedPaths(ws: TaskWorkspace): string[];
  /** Entries created next to the worktree since it was prepared, as `../name`. */
  outsideChanges(ws: TaskWorkspace): string[];
  inspect(ws: TaskWorkspace): GitInspection;
  /** Pushes the task branch to `origin` (sets upstream). */
  push(ws: TaskWorkspace): void;
}

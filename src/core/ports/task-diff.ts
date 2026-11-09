/** Port: the code a task changed, read from its worktree. Read-only; used by the web interface. */

export type DiffFileStatus = "added" | "modified" | "deleted";

export interface DiffFile {
  path: string;
  status: DiffFileStatus;
  binary: boolean;
  /** Absent for binary files. */
  additions?: number;
  deletions?: number;
  /** Unified diff of the file, hunks only. Absent for binary files and for patches too large to send. */
  patch?: string;
  /** True when the patch was left out because it was too large. */
  truncated?: boolean;
}

export interface TaskDiffResult {
  files: DiffFile[];
  /** True when more files changed than `files` lists. */
  moreFiles: boolean;
}

export interface TaskDiffRequest {
  /** The task's worktree. */
  worktree: string;
  startSha: string;
  /** Absent while the task has not passed yet: the diff then runs to the current content of the worktree. */
  commitSha?: string;
}

/** Thrown when there is nothing to read: the worktree is gone or a commit is unknown. */
export class TaskDiffUnavailableError extends Error {}

export interface TaskDiff {
  diff(request: TaskDiffRequest): TaskDiffResult;
}

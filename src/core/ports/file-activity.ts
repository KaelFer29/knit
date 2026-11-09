/** Port: the files a task worktree has changed right now, read from git. Read-only; used by the web interface. */

export interface WorktreeChanges {
  /** Relative paths changed in the worktree (modified, deleted, staged, untracked), each once. */
  paths: string[];
  /** True when more paths changed than `paths` lists. */
  moreFiles: boolean;
}

/** Thrown when there is nothing to read: the worktree is gone or git cannot read it. */
export class FileActivityUnavailableError extends Error {}

export interface FileActivity {
  worktreeChanges(worktree: string): WorktreeChanges;
}

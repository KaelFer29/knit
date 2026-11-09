import { existsSync } from "node:fs";
import { join } from "node:path";
import { confinePath } from "../../../core/timeline/file-activity.js";
import { FileActivityUnavailableError, type FileActivity, type WorktreeChanges } from "../../../core/ports/file-activity.js";
import { listChangedPaths } from "./changes.js";

const MAX_PATHS = 200;

/** Reads the files a task worktree has changed with `git status`, through the same helper the scope check uses. */
export class GitFileActivity implements FileActivity {
  worktreeChanges(worktree: string): WorktreeChanges {
    if (!existsSync(worktree)) throw new FileActivityUnavailableError("The task's worktree no longer exists");
    // A worktree or repository has `.git` (a file in a worktree); without it git would only print a fatal error.
    if (!existsSync(join(worktree, ".git"))) throw new FileActivityUnavailableError("The directory is not a git worktree");
    let raw: string[];
    try {
      raw = listChangedPaths(worktree);
    } catch {
      throw new FileActivityUnavailableError("The worktree's changes could not be read");
    }
    const paths = [...new Set(raw.map((p) => confinePath(p)).filter((p): p is string => p !== undefined))];
    return { paths: paths.slice(0, MAX_PATHS), moreFiles: paths.length > MAX_PATHS };
  }
}

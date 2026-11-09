import { realpathSync } from "node:fs";
import { sep } from "node:path";

/**
 * Whether `path` is a real directory inside `runDir`, after links are resolved. A worktree path comes from the
 * database, so before anything edits or deletes it the command checks it is one the run itself made: a path that
 * escapes with `..`, or through a symlink, or that does not exist, is not owned.
 */
export function ownsWorktree(path: string, runDir: string): boolean {
  try {
    const real = realpathSync(path);
    const root = realpathSync(runDir);
    return real.startsWith(root + sep);
  } catch {
    return false;
  }
}

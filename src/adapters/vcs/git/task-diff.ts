import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  TaskDiffUnavailableError,
  type DiffFile,
  type DiffFileStatus,
  type TaskDiff,
  type TaskDiffRequest,
  type TaskDiffResult,
} from "../../../core/ports/task-diff.js";

const MAX_FILES = 200;
const MAX_PATCH_CHARS = 100_000;
const SHA = /^[0-9a-f]{7,64}$/;

function run(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "core.quotepath=off", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** Splits a full unified diff into the part of each file, in order. `diff --git` only starts a file at a line start. */
function splitPatch(full: string): string[] {
  return full.split(/^(?=diff --git )/m).filter((p) => p !== "");
}

/** The diff without its header lines: from the first hunk on (a binary file has none). */
function hunksOf(part: string): string | undefined {
  const at = part.search(/^@@ /m);
  return at === -1 ? undefined : part.slice(at);
}

function statusOf(part: string): DiffFileStatus {
  if (/^new file mode /m.test(part)) return "added";
  if (/^deleted file mode /m.test(part)) return "deleted";
  return "modified";
}

/**
 * Reads what a task changed with `git diff <startSha> <commitSha>` inside its worktree. Renames are reported as a
 * delete plus an add, like the scope check does. Without a `commitSha` it compares with the worktree's tracked files.
 */
export class GitTaskDiff implements TaskDiff {
  diff({ worktree, startSha, commitSha }: TaskDiffRequest): TaskDiffResult {
    if (!SHA.test(startSha) || (commitSha !== undefined && !SHA.test(commitSha))) {
      throw new TaskDiffUnavailableError("Not a commit id");
    }
    if (!existsSync(worktree)) throw new TaskDiffUnavailableError("The task's worktree no longer exists");
    const range = commitSha === undefined ? [startSha] : [startSha, commitSha];
    const base = ["diff", "--no-color", "--no-ext-diff", "--no-renames"];
    let numstat: string;
    let full: string;
    try {
      numstat = run(worktree, [...base, "--numstat", "-z", ...range, "--"]);
      full = run(worktree, [...base, ...range, "--"]);
    } catch {
      throw new TaskDiffUnavailableError("The diff could not be read from the worktree");
    }
    const stats = numstat.split("\0").filter((s) => s !== "");
    const parts = splitPatch(full);
    const files: DiffFile[] = [];
    stats.slice(0, MAX_FILES).forEach((entry, i) => {
      const [adds = "", dels = "", ...rest] = entry.split("\t");
      const part = parts[i] ?? "";
      const binary = adds === "-";
      const hunks = binary ? undefined : hunksOf(part);
      const tooLarge = hunks !== undefined && hunks.length > MAX_PATCH_CHARS;
      files.push({
        path: rest.join("\t"),
        status: statusOf(part),
        binary,
        ...(binary ? {} : { additions: Number(adds), deletions: Number(dels) }),
        ...(hunks !== undefined && !tooLarge ? { patch: hunks } : {}),
        ...(tooLarge ? { truncated: true } : {}),
      });
    });
    return { files, moreFiles: stats.length > MAX_FILES };
  }
}

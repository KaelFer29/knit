import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

/**
 * Paths changed in a worktree relative to HEAD: modified, deleted, staged and untracked
 * (listed per file, not per directory). Both sides of a rename/copy are reported.
 */
export function listChangedPaths(worktree: string): string[] {
  const out = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: worktree,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const entries = out.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    paths.push(entry.slice(3));
    // Renames and copies are followed by the origin path as a separate entry.
    if (status.includes("R") || status.includes("C")) {
      const origin = entries[++i];
      if (origin) paths.push(origin);
    }
  }
  return paths;
}

/**
 * Paths that differ from `startSha`: committed, staged, unstaged and untracked (not ignored).
 * Renames are reported as a delete plus an add, so both paths are checked against the scope.
 */
export function listChangedSince(worktree: string, startSha: string): string[] {
  const run = (args: string[]): string[] =>
    execFileSync("git", args, { cwd: worktree, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\0")
      .filter((p) => p !== "");
  const tracked = run(["diff", "--name-only", "--no-renames", "-z", startSha]);
  const untracked = run(["ls-files", "--others", "--exclude-standard", "-z"]);
  return [...new Set([...tracked, ...untracked])];
}

/** Names directly inside a directory; used to detect writes outside the worktree. */
export function snapshotDir(dir: string): Set<string> {
  return new Set(readdirSync(dir));
}

export function newEntries(before: Set<string>, after: Set<string>): string[] {
  return [...after].filter((name) => !before.has(name)).sort();
}

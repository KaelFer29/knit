import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskDiffUnavailableError } from "../../../core/ports/task-diff.js";
import { GitTaskDiff } from "./task-diff.js";

let root: string;
let repo: string;
let start: string;
let commit: string;

// Hooks disabled so the user's global git hooks never affect the scratch repo.
function git(...args: string[]): string {
  const config = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null"];
  return execFileSync("git", [...config, ...args], { cwd: repo, encoding: "utf8" }).trim();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "orq-task-diff-"));
  repo = join(root, "repo");
  mkdirSync(repo);
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "keep.txt"), "one\ntwo\n");
  writeFileSync(join(repo, "gone.txt"), "bye\n");
  git("add", ".");
  git("commit", "-qm", "chore: init");
  start = git("rev-parse", "HEAD");
  writeFileSync(join(repo, "keep.txt"), "one\nTWO\nthree\n");
  writeFileSync(join(repo, "new file.ts"), "export const a = 1;\n");
  writeFileSync(join(repo, "bin.dat"), Buffer.from([0, 1, 2, 0, 255]));
  git("rm", "-q", "gone.txt");
  git("add", ".");
  git("commit", "-qm", "feat: change");
  commit = git("rev-parse", "HEAD");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("GitTaskDiff", () => {
  it("lists every file with status, counts and its hunks", () => {
    const { files, moreFiles } = new GitTaskDiff().diff({ worktree: repo, startSha: start, commitSha: commit });
    expect(moreFiles).toBe(false);
    const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
    expect(Object.keys(byPath).sort()).toEqual(["bin.dat", "gone.txt", "keep.txt", "new file.ts"]);
    expect(byPath["keep.txt"]).toMatchObject({ status: "modified", additions: 2, deletions: 1, binary: false });
    expect(byPath["keep.txt"]!.patch).toBe("@@ -1,2 +1,3 @@\n one\n-two\n+TWO\n+three\n");
    expect(byPath["new file.ts"]).toMatchObject({ status: "added", additions: 1, deletions: 0 });
    expect(byPath["gone.txt"]).toMatchObject({ status: "deleted", additions: 0, deletions: 1 });
    expect(byPath["bin.dat"]).toEqual({ path: "bin.dat", status: "added", binary: true });
  });

  it("without a commit compares with the worktree", () => {
    writeFileSync(join(repo, "keep.txt"), "one\ntwo\nfour\n");
    const { files } = new GitTaskDiff().diff({ worktree: repo, startSha: commit });
    expect(files.map((f) => f.path)).toEqual(["keep.txt"]);
    expect(files[0]!.patch).toContain("+four");
  });

  it("is empty when nothing changed", () => {
    expect(new GitTaskDiff().diff({ worktree: repo, startSha: commit, commitSha: commit })).toEqual({ files: [], moreFiles: false });
  });

  it("leaves out a patch that is too large and says so", () => {
    writeFileSync(join(repo, "big.txt"), `${"y".repeat(79)}\n`.repeat(1500));
    git("add", ".");
    git("commit", "-qm", "feat: big");
    const { files } = new GitTaskDiff().diff({ worktree: repo, startSha: commit, commitSha: git("rev-parse", "HEAD") });
    expect(files).toEqual([{ path: "big.txt", status: "added", binary: false, additions: 1500, deletions: 0, truncated: true }]);
  });

  it("refuses values that are not commit ids, so they never reach git as options", () => {
    const reader = new GitTaskDiff();
    expect(() => reader.diff({ worktree: repo, startSha: "--output=x", commitSha: commit })).toThrow(TaskDiffUnavailableError);
    expect(() => reader.diff({ worktree: repo, startSha: start, commitSha: "HEAD" })).toThrow(TaskDiffUnavailableError);
  });

  it("reports a missing worktree and an unknown commit as unavailable", () => {
    expect(() => new GitTaskDiff().diff({ worktree: join(root, "nope"), startSha: start, commitSha: commit })).toThrow(TaskDiffUnavailableError);
    expect(() => new GitTaskDiff().diff({ worktree: repo, startSha: "deadbeef", commitSha: commit })).toThrow(TaskDiffUnavailableError);
  });
});

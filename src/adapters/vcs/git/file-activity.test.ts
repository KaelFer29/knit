import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileActivityUnavailableError } from "../../../core/ports/file-activity.js";
import { GitFileActivity } from "./file-activity.js";

let root: string;
let repo: string;

// Hooks disabled so the user's global git hooks never affect the scratch repo.
function git(...args: string[]): string {
  const config = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null"];
  return execFileSync("git", [...config, ...args], { cwd: repo, encoding: "utf8" }).trim();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "orq-file-activity-"));
  repo = join(root, "repo");
  mkdirSync(repo);
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "tracked.txt"), "one\n");
  writeFileSync(join(repo, "gone.txt"), "bye\n");
  git("add", ".");
  git("commit", "-qm", "chore: init");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("GitFileActivity", () => {
  it("lists modified, deleted, staged and untracked paths of the worktree, relative and each once", () => {
    writeFileSync(join(repo, "tracked.txt"), "two\n");
    git("rm", "-q", "gone.txt");
    writeFileSync(join(repo, "staged.ts"), "export {};\n");
    git("add", "staged.ts");
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "new file.ts"), "export {};\n");

    const { paths, moreFiles } = new GitFileActivity().worktreeChanges(repo);

    expect([...paths].sort()).toEqual(["gone.txt", "src/new file.ts", "staged.ts", "tracked.txt"]);
    expect(moreFiles).toBe(false);
  });

  it("reports nothing for a clean worktree", () => {
    expect(new GitFileActivity().worktreeChanges(repo)).toEqual({ paths: [], moreFiles: false });
  });

  it("lists at most 200 paths and says that more changed", () => {
    for (let i = 0; i < 205; i++) writeFileSync(join(repo, `f${String(i).padStart(3, "0")}.txt`), "x\n");

    const { paths, moreFiles } = new GitFileActivity().worktreeChanges(repo);

    expect(paths).toHaveLength(200);
    expect(moreFiles).toBe(true);
  });

  it("refuses a worktree that no longer exists", () => {
    expect(() => new GitFileActivity().worktreeChanges(join(root, "missing"))).toThrow(FileActivityUnavailableError);
  });

  it("refuses a directory that is not a git worktree", () => {
    const plain = join(root, "plain");
    mkdirSync(plain);
    expect(() => new GitFileActivity().worktreeChanges(plain)).toThrow(FileActivityUnavailableError);
  });
});

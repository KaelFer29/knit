import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listChangedPaths, newEntries, snapshotDir } from "./changes.js";

let root: string;
let repo: string;

function git(...args: string[]): void {
  // Hooks disabled so the user's global git hooks never affect the scratch repo.
  const config = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null"];
  execFileSync("git", [...config, ...args], { cwd: repo, stdio: "ignore" });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "orq-git-"));
  repo = join(root, "repo");
  mkdirSync(repo);
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "keep.txt"), "keep\n");
  writeFileSync(join(repo, "old name.txt"), "content that is long enough to be detected as a rename\n");
  git("add", ".");
  git("commit", "-qm", "chore: init");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("listChangedPaths", () => {
  it("returns nothing for a clean worktree", () => {
    expect(listChangedPaths(repo)).toEqual([]);
  });

  it("lists modified, untracked (inside new dirs) and deleted files", () => {
    writeFileSync(join(repo, "keep.txt"), "changed\n");
    mkdirSync(join(repo, "new/deep"), { recursive: true });
    writeFileSync(join(repo, "new/deep/f.ts"), "x\n");
    rmSync(join(repo, "old name.txt"));
    expect(listChangedPaths(repo).sort()).toEqual(["keep.txt", "new/deep/f.ts", "old name.txt"]);
  });

  it("reports both sides of a rename and handles spaces in names", () => {
    renameSync(join(repo, "old name.txt"), join(repo, "new name.txt"));
    git("add", "-A");
    expect(listChangedPaths(repo).sort()).toEqual(["new name.txt", "old name.txt"]);
  });
});

describe("snapshotDir / newEntries", () => {
  it("detects entries created in the parent of the worktree", () => {
    const before = snapshotDir(root);
    writeFileSync(join(root, "outside.txt"), "x\n");
    expect(newEntries(before, snapshotDir(root))).toEqual(["outside.txt"]);
  });

  it("returns nothing when the directory is unchanged", () => {
    expect(newEntries(snapshotDir(root), snapshotDir(root))).toEqual([]);
  });
});

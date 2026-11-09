import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BranchRef } from "../../../core/ports/branch-tools.js";
import { GitBranchTools } from "./git-branch-tools.js";

// Hooks disabled and an identity given, so a scratch repo never reads the user's global git config.
const GIT_ARGS = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null"];

let scratch: string;
let repo: string;
let start: string;
let tools: GitBranchTools;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", [...GIT_ARGS, ...args], { cwd, encoding: "utf8" }).trim();
}
const branchExists = (branch: string): boolean => {
  try {
    git(repo, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`);
    return true;
  } catch {
    return false;
  }
};

/** A task worktree on a new branch, the way Knit prepares it. */
function worktree(branch = "feat/one"): { ref: BranchRef; path: string } {
  const path = join(scratch, "worktrees", branch.replace("/", "-"));
  mkdirSync(join(path, ".."), { recursive: true });
  git(repo, "worktree", "add", "-q", "-b", branch, path, start);
  return { ref: { repo, branch, startSha: start, worktree: path }, path };
}

/** What the agent does: write a file and commit it. */
function commit(path: string, file: string, text: string, message: string): void {
  mkdirSync(join(path, file, ".."), { recursive: true });
  writeFileSync(join(path, file), text);
  git(path, "add", "-A");
  git(path, "commit", "-q", "-m", message);
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "knit-branch-"));
  repo = join(scratch, "target");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "base.txt"), "base\n");
  writeFileSync(join(repo, "keep.txt"), "keep\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "chore: init");
  start = git(repo, "rev-parse", "HEAD");
  tools = new GitBranchTools({ gitArgs: GIT_ARGS });
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe("GitBranchTools.state", () => {
  it("reports a missing branch as not existing, without throwing", () => {
    expect(tools.state({ repo, branch: "feat/none", startSha: start })).toMatchObject({ exists: false, ahead: [], hasWorktree: false, pushed: false });
  });

  it("lists the commits since the start, oldest first, with the head and a clean worktree", () => {
    const { ref, path } = worktree();
    commit(path, "a.txt", "a\n", "feat: add a");
    commit(path, "b.txt", "b\n", "feat: add b");
    const s = tools.state(ref);
    expect(s).toMatchObject({ exists: true, historyIntact: true, hasWorktree: true, dirty: false, pushed: false });
    expect(s.ahead.map((c) => c.subject)).toEqual(["feat: add a", "feat: add b"]);
    expect(s.head).toBe(git(path, "rev-parse", "HEAD"));
  });

  it("sees uncommitted changes, tracked or new, as dirty", () => {
    const { ref, path } = worktree();
    writeFileSync(join(path, "new.txt"), "x\n");
    expect(tools.state(ref).dirty).toBe(true);
  });

  it("sees a branch with the same name on origin as pushed", () => {
    const bare = join(scratch, "origin.git");
    git(scratch, "init", "-q", "--bare", bare);
    git(repo, "remote", "add", "origin", bare);
    const { ref, path } = worktree();
    commit(path, "a.txt", "a\n", "feat: add a");
    expect(tools.state(ref).pushed).toBe(false);
    git(path, "push", "-q", "-u", "origin", "feat/one");
    expect(tools.state(ref).pushed).toBe(true);
  });

  it("notices a rewritten history: the start commit is no longer on the branch", () => {
    const { ref } = worktree();
    const tree = git(repo, "rev-parse", "main^{tree}");
    const orphan = git(repo, "commit-tree", tree, "-m", "unrelated root");
    git(repo, "update-ref", "-d", "refs/heads/feat/one");
    git(repo, "worktree", "prune");
    git(repo, "branch", "feat/one", orphan);
    expect(tools.state({ ...ref, worktree: undefined }).historyIntact).toBe(false);
  });
});

describe("GitBranchTools.revert", () => {
  it("adds one commit that restores the code to the start: added files go, edits and deletions come back", () => {
    const { ref, path } = worktree();
    commit(path, "a.txt", "a\n", "feat: add a");
    commit(path, "base.txt", "changed\n", "feat: edit base");
    git(path, "rm", "-q", "keep.txt");
    git(path, "commit", "-qm", "feat: drop keep");
    const before = Number(git(path, "rev-list", "--count", `${start}..HEAD`));
    const { sha } = tools.revert(ref);
    expect(Number(git(path, "rev-list", "--count", `${start}..HEAD`))).toBe(before + 1);
    expect(sha).toBe(git(path, "rev-parse", "HEAD"));
    expect(existsSync(join(path, "a.txt"))).toBe(false);
    expect(readFileSync(join(path, "base.txt"), "utf8")).toBe("base\n");
    expect(readFileSync(join(path, "keep.txt"), "utf8")).toBe("keep\n");
    expect(git(path, "status", "--porcelain")).toBe("");
    expect(git(path, "diff", "--stat", start, "HEAD")).toBe("");
  });

  it("works when the worktree is gone, as long as nobody has the branch checked out", () => {
    const { ref, path } = worktree();
    commit(path, "a.txt", "a\n", "feat: add a");
    git(repo, "worktree", "remove", "--force", path);
    const { sha } = tools.revert({ ...ref, worktree: undefined });
    expect(git(repo, "rev-parse", "feat/one")).toBe(sha);
    expect(git(repo, "diff", "--stat", start, "feat/one")).toBe("");
    expect(git(repo, "log", "--format=%P", "-1", "feat/one").split(" ")).toHaveLength(1);
  });

  it("refuses over uncommitted changes and changes nothing", () => {
    const { ref, path } = worktree();
    commit(path, "a.txt", "a\n", "feat: add a");
    writeFileSync(join(path, "scratch.txt"), "mine\n");
    const head = git(path, "rev-parse", "HEAD");
    expect(() => tools.revert(ref)).toThrow(/uncommitted/i);
    expect(git(path, "rev-parse", "HEAD")).toBe(head);
    expect(existsSync(join(path, "scratch.txt"))).toBe(true);
  });

  it("says so when the branch already equals the start, instead of making an empty commit", () => {
    const { ref, path } = worktree();
    commit(path, "a.txt", "a\n", "feat: add a");
    git(path, "rm", "-q", "a.txt");
    git(path, "commit", "-qm", "fix: drop a");
    const head = git(path, "rev-parse", "HEAD");
    expect(() => tools.revert(ref)).toThrow(/already identical/i);
    expect(git(path, "rev-parse", "HEAD")).toBe(head);
  });
});

describe("GitBranchTools.reset", () => {
  it("moves the branch and its worktree back to the start commit", () => {
    const { ref, path } = worktree();
    commit(path, "a.txt", "a\n", "feat: add a");
    tools.reset(ref);
    expect(git(path, "rev-parse", "HEAD")).toBe(start);
    expect(existsSync(join(path, "a.txt"))).toBe(false);
    expect(branchExists("feat/one")).toBe(true);
  });

  it("moves a branch without a worktree back to the start too", () => {
    const { ref, path } = worktree();
    commit(path, "a.txt", "a\n", "feat: add a");
    git(repo, "worktree", "remove", "--force", path);
    tools.reset({ ...ref, worktree: undefined });
    expect(git(repo, "rev-parse", "feat/one")).toBe(start);
  });
});

describe("GitBranchTools.remove", () => {
  it("removes the worktree and deletes the branch even when its commits are not merged, and leaves origin alone", () => {
    const bare = join(scratch, "origin.git");
    git(scratch, "init", "-q", "--bare", bare);
    git(repo, "remote", "add", "origin", bare);
    const { ref, path } = worktree();
    commit(path, "a.txt", "a\n", "feat: add a");
    git(path, "push", "-q", "-u", "origin", "feat/one");
    tools.remove(ref);
    expect(existsSync(path)).toBe(false);
    expect(branchExists("feat/one")).toBe(false);
    expect(git(bare, "branch", "--list", "feat/one")).toContain("feat/one");
  });

  it("deletes a branch whose worktree is already gone, and one that is already gone altogether", () => {
    const { ref, path } = worktree();
    git(repo, "worktree", "remove", "--force", path);
    tools.remove({ ...ref, worktree: undefined });
    expect(branchExists("feat/one")).toBe(false);
    expect(() => tools.remove({ ...ref, worktree: undefined })).not.toThrow();
  });

  it("never touches the branch the main checkout is on", () => {
    expect(() => tools.remove({ repo, branch: "main", startSha: start })).toThrow(/checked out/i);
    expect(branchExists("main")).toBe(true);
  });
});

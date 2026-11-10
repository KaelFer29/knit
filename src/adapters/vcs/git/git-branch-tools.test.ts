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

describe("GitBranchTools.diff", () => {
  it("returns the stat and the patch of what the branch changed since the start", () => {
    const { ref, path } = worktree();
    commit(path, "a.txt", "hello\n", "feat: add a");
    const d = tools.diff(ref, 10_000);
    expect(d.stat).toContain("a.txt");
    expect(d.patch).toContain("+hello");
    expect(d.truncated).toBe(false);
  });

  it("cuts a long patch to the byte limit and says so", () => {
    const { ref, path } = worktree();
    commit(path, "big.txt", "x".repeat(5000) + "\n", "feat: add big");
    const d = tools.diff(ref, 1000);
    expect(d.truncated).toBe(true);
    expect(Buffer.byteLength(d.patch)).toBeLessThanOrEqual(1000);
    expect(d.stat).toContain("big.txt");
  });

  it("is empty for a branch that does not exist", () => {
    expect(tools.diff({ repo, branch: "feat/none", startSha: start }, 1000)).toEqual({ stat: "", patch: "", truncated: false });
  });
});

describe("GitBranchTools.push", () => {
  it("pushes the branch to origin with its upstream, from the main checkout, without needing the worktree", () => {
    const bare = join(scratch, "origin.git");
    git(scratch, "init", "-q", "--bare", bare);
    git(repo, "remote", "add", "origin", bare);
    const { ref, path } = worktree();
    commit(path, "a.txt", "a\n", "feat: add a");
    tools.push({ ...ref, worktree: undefined });
    expect(git(bare, "branch", "--list", "feat/one")).toContain("feat/one");
    expect(tools.state(ref).pushed).toBe(true);
  });

  it("never forces: a remote branch that moved on is an error, and it is left as it was", () => {
    const bare = join(scratch, "origin.git");
    git(scratch, "init", "-q", "--bare", bare);
    git(repo, "remote", "add", "origin", bare);
    const { ref, path } = worktree();
    commit(path, "a.txt", "a\n", "feat: add a");
    tools.push(ref);
    const other = join(scratch, "other");
    git(scratch, "clone", "-q", bare, other);
    git(other, "checkout", "-q", "feat/one");
    writeFileSync(join(other, "z.txt"), "z\n");
    git(other, "add", ".");
    git(other, "commit", "-qm", "feat: someone else");
    git(other, "push", "-q", "origin", "feat/one");
    const remoteHead = git(bare, "rev-parse", "feat/one");
    commit(path, "b.txt", "b\n", "feat: add b");
    expect(() => tools.push(ref)).toThrow(/rejected|failed/i);
    expect(git(bare, "rev-parse", "feat/one")).toBe(remoteHead);
  });

  it("says so when there is no origin", () => {
    const { ref } = worktree();
    expect(() => tools.push(ref)).toThrow(/origin/i);
  });
});

describe("GitBranchTools.remoteBranches", () => {
  it("lists the branches origin has right now, sorted, asking the remote and not the local tracking refs", () => {
    const bare = join(scratch, "origin.git");
    git(scratch, "init", "-q", "--bare", bare);
    git(repo, "remote", "add", "origin", bare);
    git(repo, "push", "-q", "origin", "HEAD:refs/heads/main");
    git(repo, "push", "-q", "origin", "HEAD:refs/heads/release/1.2");
    expect(tools.remoteBranches(repo)).toEqual(["main", "release/1.2"]);
    // A branch pushed by someone else, and one deleted, with no fetch in this clone: the list still follows the remote.
    git(bare, "update-ref", "refs/heads/docs/new", git(bare, "rev-parse", "main"));
    git(bare, "update-ref", "-d", "refs/heads/release/1.2");
    expect(tools.remoteBranches(repo)).toEqual(["docs/new", "main"]);
  });

  it("is empty for a remote without branches", () => {
    const bare = join(scratch, "origin.git");
    git(scratch, "init", "-q", "--bare", bare);
    git(repo, "remote", "add", "origin", bare);
    expect(tools.remoteBranches(repo)).toEqual([]);
  });

  it("says so when there is no origin or it cannot be reached", () => {
    expect(() => tools.remoteBranches(repo)).toThrow(/origin/i);
  });
});

describe("GitBranchTools.checkout", () => {
  const head = (): string => git(repo, "rev-parse", "--abbrev-ref", "HEAD");

  it("frees the worktree and switches the repository to the branch, which keeps its commits", () => {
    const { ref, path } = worktree();
    commit(path, "a.txt", "a\n", "feat: add a");
    expect(tools.checkout(ref)).toEqual({ freedWorktree: true, from: "main" });
    expect(existsSync(path)).toBe(false);
    expect(head()).toBe("feat/one");
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("a\n");
    expect(tools.state({ ...ref, worktree: undefined })).toMatchObject({ exists: true, hasWorktree: false, checkedOut: true });
  });

  it("is not forced by git alone: the same branch cannot be in two places, which is why the worktree goes first", () => {
    const { ref } = worktree();
    expect(() => git(repo, "checkout", "feat/one")).toThrow(/already used by worktree/);
    tools.checkout(ref);
    expect(head()).toBe("feat/one");
  });

  it("works when the worktree is already gone, and does nothing when the repository is already on the branch", () => {
    const { ref, path } = worktree();
    commit(path, "a.txt", "a\n", "feat: add a");
    git(repo, "worktree", "remove", path);
    expect(tools.checkout({ ...ref, worktree: undefined })).toEqual({ freedWorktree: false, from: "main" });
    expect(head()).toBe("feat/one");
    expect(tools.checkout({ ...ref, worktree: undefined })).toEqual({ freedWorktree: false });
  });

  it("refuses, and touches nothing, when the repository has uncommitted changes (tracked or new files)", () => {
    const { ref, path } = worktree();
    commit(path, "a.txt", "a\n", "feat: add a");
    const before = head();
    writeFileSync(join(repo, "README.md"), "changed\n");
    expect(() => tools.checkout(ref)).toThrow(/uncommitted changes/);
    rmSync(join(repo, "README.md"));
    git(repo, "checkout", "--", ".");
    writeFileSync(join(repo, "new.txt"), "x\n");
    expect(() => tools.checkout(ref)).toThrow(/uncommitted changes/);
    expect(existsSync(path)).toBe(true);
    expect(head()).toBe(before);
  });

  it("refuses, and keeps the worktree, when the worktree has uncommitted changes", () => {
    const { ref, path } = worktree();
    commit(path, "a.txt", "a\n", "feat: add a");
    writeFileSync(join(path, "wip.txt"), "wip\n");
    expect(() => tools.checkout(ref)).toThrow(/worktree.*uncommitted changes/i);
    expect(existsSync(join(path, "wip.txt"))).toBe(true);
    expect(head()).not.toBe("feat/one");
  });

  it("refuses a branch that is checked out in another worktree than the task's", () => {
    const { ref } = worktree();
    expect(() => tools.checkout({ ...ref, worktree: join(scratch, "elsewhere") })).toThrow(/checked out at/);
  });

  it("says so when the branch does not exist", () => {
    const { ref } = worktree();
    git(repo, "worktree", "remove", ref.worktree!);
    git(repo, "branch", "-D", "feat/one");
    expect(() => tools.checkout({ ...ref, worktree: undefined })).toThrow(/no longer exists/);
  });
});

describe("GitBranchTools.commitsSince", () => {
  it("counts the commits of the branch that a given commit does not have", () => {
    const { ref, path } = worktree();
    commit(path, "a.txt", "a\n", "feat: add a");
    const merged = git(path, "rev-parse", "HEAD");
    expect(tools.commitsSince(repo, merged, "feat/one")).toBe(0);
    commit(path, "b.txt", "b\n", "feat: add b");
    commit(path, "c.txt", "c\n", "feat: add c");
    expect(tools.commitsSince(repo, merged, "feat/one")).toBe(2);
    expect(tools.commitsSince(repo, start, "feat/one")).toBe(3);
    expect(ref.branch).toBe("feat/one");
  });

  it("is unknown when the commit is not in this repository, or the branch is gone", () => {
    const { path } = worktree();
    commit(path, "a.txt", "a\n", "feat: add a");
    expect(tools.commitsSince(repo, "0000000000000000000000000000000000000000", "feat/one")).toBeUndefined();
    expect(tools.commitsSince(repo, start, "feat/nope")).toBeUndefined();
  });
});


describe("GitBranchTools.returnRepository", () => {
  const head = (): string => git(repo, "rev-parse", "--abbrev-ref", "HEAD");

  it("switches the repository back to the branch it was on before the test, and the branch's commits stay", () => {
    const { ref, path } = worktree();
    commit(path, "a.txt", "a\n", "feat: add a");
    const { from } = tools.checkout(ref);
    expect(from).toBe("main");
    tools.returnRepository(repo, from!);
    expect(head()).toBe("main");
    expect(tools.state({ ...ref, worktree: undefined })).toMatchObject({ exists: true, checkedOut: false });
  });

  it("does nothing when the repository is already on that branch", () => {
    expect(() => tools.returnRepository(repo, "main")).not.toThrow();
    expect(head()).toBe("main");
  });

  it("refuses with uncommitted changes and touches nothing", () => {
    const { ref, path } = worktree();
    commit(path, "a.txt", "a\n", "feat: add a");
    tools.checkout(ref);
    writeFileSync(join(repo, "new.txt"), "x\n");
    expect(() => tools.returnRepository(repo, "main")).toThrow(/uncommitted changes/);
    expect(head()).toBe("feat/one");
  });
});

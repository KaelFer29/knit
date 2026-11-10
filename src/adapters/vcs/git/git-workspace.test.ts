import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitWorkspace } from "./git-workspace.js";

// Hooks disabled so the user's global git hooks never affect scratch repos.
const GIT_ARGS = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null"];

let scratch: string;
let repo: string;
let ws: GitWorkspace;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", [...GIT_ARGS, ...args], { cwd, encoding: "utf8" }).trim();
}

function prepare(taskId = "T1", branch = "feat/one", startPoint?: string) {
  return ws.prepare({ repo, runId: "run-1", taskId, branch, startPoint: startPoint ?? ws.resolveBase(repo).sha });
}

/** Simulates the agent: write a file and commit it inside the worktree. */
function agentCommit(path: string, file: string, message: string): void {
  mkdirSync(join(path, file, ".."), { recursive: true });
  writeFileSync(join(path, file), `${message}\n`);
  git(path, "add", "-A");
  git(path, "commit", "-q", "-m", message);
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "orq-ws-"));
  repo = join(scratch, "target");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "base.txt"), "base\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "chore: init");
  ws = new GitWorkspace({ root: join(scratch, "worktrees"), gitArgs: GIT_ARGS });
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe("GitWorkspace.resolveBase", () => {
  it("defaults to HEAD and reports the current branch", () => {
    expect(ws.resolveBase(repo)).toEqual({ sha: git(repo, "rev-parse", "HEAD"), branch: "main" });
  });

  it("resolves an explicit local branch", () => {
    git(repo, "branch", "feature");
    expect(ws.resolveBase(repo, "feature")).toEqual({ sha: git(repo, "rev-parse", "feature"), branch: "feature" });
  });

  it("reports no branch for a raw commit or a detached HEAD", () => {
    const sha = git(repo, "rev-parse", "HEAD");
    expect(ws.resolveBase(repo, sha)).toEqual({ sha });
    git(repo, "checkout", "-q", "--detach");
    expect(ws.resolveBase(repo)).toEqual({ sha });
  });

  it("throws a clear error for an unknown ref", () => {
    expect(() => ws.resolveBase(repo, "no-such-ref")).toThrow(/no-such-ref/);
  });
});

describe("GitWorkspace.prepare and attach", () => {
  it("creates an isolated worktree on the plan's branch from the start point", () => {
    const base = ws.resolveBase(repo).sha;
    const t = prepare("T1", "feat/one", base);
    expect(t.path).toBe(join(scratch, "worktrees", "run-1", "T1", "repo"));
    expect(t.branch).toBe("feat/one");
    expect(t.startSha).toBe(base);
    expect(git(t.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe("feat/one");
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  it("lets a dependent task start from another task's branch", () => {
    const t1 = prepare("T1", "feat/one");
    agentCommit(t1.path, "one.txt", "feat(core): add one");
    const t2 = prepare("T2", "feat/two", "feat/one");
    expect(existsSync(join(t2.path, "one.txt"))).toBe(true);
    expect(t2.startSha).toBe(git(repo, "rev-parse", "feat/one"));
  });

  it("refuses to reuse an existing branch name and leaves nothing behind", () => {
    git(repo, "branch", "feat/one");
    expect(() => prepare("T1", "feat/one")).toThrow(/Branch 'feat\/one' already exists/);
    expect(existsSync(join(scratch, "worktrees", "run-1", "T1", "repo"))).toBe(false);
  });

  it("attaches to a kept worktree and returns undefined when it is gone", () => {
    const t = prepare();
    const again = ws.attach({ path: t.path, branch: t.branch, startSha: t.startSha });
    expect(again).toEqual(t);
    rmSync(t.path, { recursive: true });
    expect(ws.attach({ path: t.path, branch: t.branch, startSha: t.startSha })).toBeUndefined();
  });
});

describe("GitWorkspace.changedPaths", () => {
  it("is empty for a fresh worktree", () => {
    expect(ws.changedPaths(prepare())).toEqual([]);
  });

  it("reports committed, uncommitted and untracked changes against the start commit", () => {
    const t = prepare();
    agentCommit(t.path, "src/committed.ts", "feat(core): add committed");
    writeFileSync(join(t.path, "base.txt"), "changed\n");
    writeFileSync(join(t.path, "untracked.txt"), "u\n");
    expect(ws.changedPaths(t).sort()).toEqual(["base.txt", "src/committed.ts", "untracked.txt"]);
  });

  it("reports both sides of a rename and ignores a change that was reverted", () => {
    const t = prepare();
    renameSync(join(t.path, "base.txt"), join(t.path, "moved.txt"));
    git(t.path, "add", "-A");
    git(t.path, "commit", "-q", "-m", "refactor(core): move base");
    expect(ws.changedPaths(t).sort()).toEqual(["base.txt", "moved.txt"]);
    git(t.path, "revert", "--no-edit", "HEAD");
    expect(ws.changedPaths(t)).toEqual([]);
  });
});

describe("GitWorkspace.outsideChanges", () => {
  it("detects entries created next to the worktree as ../name", () => {
    const t = prepare();
    expect(ws.outsideChanges(t)).toEqual([]);
    writeFileSync(join(t.path, "..", "outside.txt"), "x\n");
    expect(ws.outsideChanges(t)).toEqual(["../outside.txt"]);
  });
});

describe("GitWorkspace.inspect", () => {
  it("reports commits since the start, oldest first, with subject and body", () => {
    const t = prepare();
    agentCommit(t.path, "a.txt", "feat(core): first");
    writeFileSync(join(t.path, "b.txt"), "b\n");
    git(t.path, "add", "-A");
    git(t.path, "commit", "-q", "-m", "fix(core): second", "-m", "this is a body");
    const i = ws.inspect(t);
    expect(i.branch).toBe("feat/one");
    expect(i.historyIntact).toBe(true);
    expect(i.uncommitted).toEqual([]);
    expect(i.commits.map((c) => [c.subject, c.body])).toEqual([
      ["feat(core): first", ""],
      ["fix(core): second", "this is a body"],
    ]);
    expect(i.commits[1]!.sha).toBe(git(t.path, "rev-parse", "HEAD"));
  });

  it("lists uncommitted files (tracked and untracked) and the current branch", () => {
    const t = prepare();
    writeFileSync(join(t.path, "base.txt"), "changed\n");
    writeFileSync(join(t.path, "new.txt"), "n\n");
    git(t.path, "checkout", "-q", "-b", "other");
    const i = ws.inspect(t);
    expect(i.branch).toBe("other");
    expect(i.uncommitted.sort()).toEqual(["base.txt", "new.txt"]);
  });

  it("detects rewritten history", () => {
    const t = prepare();
    const unrelated = git(t.path, "commit-tree", "-m", "unrelated", "4b825dc642cb6eb9a060e54bf8d69288fbee4904");
    git(t.path, "reset", "-q", "--hard", unrelated);
    expect(ws.inspect(t).historyIntact).toBe(false);
  });
});

describe("GitWorkspace.push", () => {
  it("pushes the task branch to origin", () => {
    const bare = join(scratch, "origin.git");
    execFileSync("git", ["init", "-q", "--bare", bare]);
    git(repo, "remote", "add", "origin", bare);
    const t = prepare();
    agentCommit(t.path, "a.txt", "feat(core): a");
    ws.push(t);
    expect(git(bare, "rev-parse", "feat/one")).toBe(git(t.path, "rev-parse", "HEAD"));
    agentCommit(t.path, "b.txt", "feat(core): b");
    ws.push(t);
    expect(git(bare, "rev-parse", "feat/one")).toBe(git(t.path, "rev-parse", "HEAD"));
  });

  it("throws a clear error without an origin remote", () => {
    expect(() => ws.push(prepare())).toThrow(/git push/);
  });
});

describe("GitWorkspace cleanup", () => {
  it("removes a worktree and tolerates one that is already gone", () => {
    const t = prepare();
    ws.removeWorktree(repo, t.path);
    expect(existsSync(t.path)).toBe(false);
    expect(git(repo, "worktree", "list").split("\n")).toHaveLength(1);
    expect(() => ws.removeWorktree(repo, t.path)).not.toThrow();
  });

  it("removes a worktree that has uncommitted work", () => {
    const t = prepare();
    writeFileSync(join(t.path, "dirty.txt"), "x\n");
    ws.removeWorktree(repo, t.path);
    expect(existsSync(t.path)).toBe(false);
  });

  it("deletes a merged branch but keeps an unmerged one", () => {
    const t = prepare("T1", "feat/one");
    agentCommit(t.path, "a.txt", "feat(core): a");
    ws.removeWorktree(repo, t.path);
    expect(ws.deleteBranch(repo, "feat/one")).toBe(false); // not merged into main
    expect(git(repo, "branch", "--list", "feat/one")).toContain("feat/one");
    git(repo, "merge", "-q", "--no-edit", "feat/one");
    expect(ws.deleteBranch(repo, "feat/one")).toBe(true);
    expect(git(repo, "branch", "--list", "feat/one")).toBe("");
  });

  it("reports false for a branch that does not exist", () => {
    expect(ws.deleteBranch(repo, "feat/none")).toBe(false);
  });
});

describe("GitWorkspace.restore", () => {
  const input = (w: { path: string; branch: string; startSha: string }) => ({ repo, path: w.path, branch: w.branch, startSha: w.startSha });

  it("recreates the worktree of an existing branch at the same path, with the commits the agent made", () => {
    const w = prepare();
    agentCommit(w.path, "src/a.txt", "feat: add a");
    git(repo, "worktree", "remove", w.path);
    expect(existsSync(w.path)).toBe(false);
    const back = ws.restore(input(w));
    expect(back).toEqual({ path: w.path, branch: "feat/one", startSha: w.startSha });
    expect(existsSync(join(w.path, "src/a.txt"))).toBe(true);
    expect(git(w.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe("feat/one");
  });

  it("works after the worktree folder was deleted by hand, which leaves a stale registration", () => {
    const w = prepare();
    rmSync(w.path, { recursive: true, force: true });
    expect(ws.restore(input(w)).path).toBe(w.path);
    expect(existsSync(join(w.path, ".git"))).toBe(true);
  });

  it("gives a workspace the run loop can use: what it changes is measured from the restored folder", () => {
    const w = prepare();
    git(repo, "worktree", "remove", w.path);
    const back = ws.restore(input(w));
    agentCommit(back.path, "src/b.txt", "feat: add b");
    expect(ws.changedPaths(back)).toEqual(["src/b.txt"]);
    expect(ws.outsideChanges(back)).toEqual([]);
    expect(ws.inspect(back).commits.map((c) => c.subject)).toEqual(["feat: add b"]);
  });

  it("refuses, and says how to free the branch, when the user's repository is on it", () => {
    const w = prepare();
    git(repo, "worktree", "remove", w.path);
    git(repo, "checkout", "feat/one");
    expect(() => ws.restore(input(w))).toThrow(/feat\/one is checked out at .*Return button/s);
    expect(existsSync(w.path)).toBe(false);
  });

  it("refuses a branch that no longer exists", () => {
    const w = prepare();
    git(repo, "worktree", "remove", w.path);
    git(repo, "branch", "-D", "feat/one");
    expect(() => ws.restore(input(w))).toThrow(/no longer exists/);
  });
});


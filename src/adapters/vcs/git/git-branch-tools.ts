import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BranchDiff, BranchEditor, BranchInspector, BranchRef, BranchState } from "../../../core/ports/branch-tools.js";

export interface GitBranchToolsOptions {
  /** Extra args placed before every git subcommand (e.g. `-c core.hooksPath=...` in tests). */
  gitArgs?: string[];
}

const FIELD = "\x1f";

/**
 * Looks at and edits the branch of a task with plain git. State is read from local refs only (no network): `pushed`
 * means the remote-tracking ref exists. Edits never touch a remote and never use a shell.
 */
export class GitBranchTools implements BranchInspector, BranchEditor {
  private readonly gitArgs: string[];

  constructor(options: GitBranchToolsOptions = {}) {
    this.gitArgs = options.gitArgs ?? [];
  }

  private git(cwd: string, args: string[]): string {
    try {
      return execFileSync("git", [...this.gitArgs, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).trim();
    } catch (err) {
      const e = err as { stderr?: Buffer | string; message: string };
      throw new Error(`git ${args.join(" ")} failed: ${(e.stderr ? e.stderr.toString() : e.message).trim()}`);
    }
  }

  private ok(cwd: string, args: string[]): boolean {
    try {
      this.git(cwd, args);
      return true;
    } catch {
      return false;
    }
  }

  private exists(repo: string, branch: string): boolean {
    return this.ok(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  }

  private hasWorktree(ref: BranchRef): boolean {
    return ref.worktree !== undefined && existsSync(join(ref.worktree, ".git"));
  }

  /** Where the branch is checked out, in the main checkout or any worktree. */
  private checkedOutAt(repo: string, branch: string): string | undefined {
    const listing = this.git(repo, ["worktree", "list", "--porcelain"]);
    let path: string | undefined;
    for (const line of listing.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line === `branch refs/heads/${branch}`) return path;
    }
    return undefined;
  }

  /** Whether two paths are the same directory, through links. */
  private samePath(a: string, b: string): boolean {
    const real = (p: string): string => {
      try {
        return realpathSync(p);
      } catch {
        return resolve(p);
      }
    };
    return real(a) === real(b);
  }

  /** The branch the repository is on, undefined when it is detached. */
  private currentBranch(repo: string): string | undefined {
    return this.git(repo, ["symbolic-ref", "--short", "-q", "HEAD"]) || undefined;
  }

  returnRepository(repo: string, branch: string): void {
    if (this.currentBranch(repo) === branch) return;
    if (this.git(repo, ["status", "--porcelain"]) !== "") {
      throw new Error("Your repository has uncommitted changes. Commit or stash them first, so switching branches cannot touch them");
    }
    this.git(repo, ["checkout", branch]);
  }

  checkout(ref: BranchRef): { freedWorktree: boolean; from?: string } {
    if (!this.exists(ref.repo, ref.branch)) throw new Error(`The branch ${ref.branch} no longer exists`);
    const at = this.checkedOutAt(ref.repo, ref.branch);
    if (at !== undefined && this.samePath(at, ref.repo)) return { freedWorktree: false };
    if (this.git(ref.repo, ["status", "--porcelain"]) !== "") {
      throw new Error("Your repository has uncommitted changes. Commit or stash them first, so switching branches cannot touch them");
    }
    let freedWorktree = false;
    if (at !== undefined) {
      if (ref.worktree === undefined || !this.samePath(at, ref.worktree)) throw new Error(`${ref.branch} is checked out at ${at}`);
      if (this.git(at, ["status", "--porcelain"]) !== "") throw new Error("The worktree has uncommitted changes. Commit or discard them first, so removing it loses nothing");
      // Never forced: git itself refuses to remove a worktree that holds anything it would lose.
      this.git(ref.repo, ["worktree", "remove", at]);
      freedWorktree = true;
    }
    const from = this.currentBranch(ref.repo);
    this.git(ref.repo, ["checkout", ref.branch]);
    return { freedWorktree, ...(from !== undefined ? { from } : {}) };
  }

  state(ref: BranchRef): BranchState {
    if (!this.exists(ref.repo, ref.branch)) return { exists: false, historyIntact: true, ahead: [], pushed: false, hasWorktree: false, dirty: false };
    const head = this.git(ref.repo, ["rev-parse", `refs/heads/${ref.branch}`]);
    const historyIntact = this.ok(ref.repo, ["merge-base", "--is-ancestor", ref.startSha, head]);
    const ahead = historyIntact
      ? this.git(ref.repo, ["log", "--reverse", `--format=%H${FIELD}%s`, `${ref.startSha}..${head}`])
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => {
            const [sha = "", subject = ""] = line.split(FIELD);
            return { sha, subject };
          })
      : [];
    const hasWorktree = this.hasWorktree(ref);
    return {
      exists: true,
      head,
      historyIntact,
      ahead,
      checkedOut: ((at) => at !== undefined && this.samePath(at, ref.repo))(this.checkedOutAt(ref.repo, ref.branch)),
      pushed: this.ok(ref.repo, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${ref.branch}`]),
      hasWorktree,
      dirty: hasWorktree && this.git(ref.worktree!, ["status", "--porcelain"]) !== "",
    };
  }

  diff(ref: BranchRef, maxBytes: number): BranchDiff {
    if (!this.exists(ref.repo, ref.branch)) return { stat: "", patch: "", truncated: false };
    const range = [`${ref.startSha}`, `refs/heads/${ref.branch}`];
    const flags = ["--no-ext-diff", "--no-color"];
    const stat = this.git(ref.repo, ["diff", ...flags, "--stat", ...range]);
    const patch = this.git(ref.repo, ["diff", ...flags, ...range]);
    const bytes = Buffer.from(patch, "utf8");
    if (bytes.length <= maxBytes) return { stat, patch, truncated: false };
    // Cut on bytes, then drop a character the cut split in half.
    return { stat, patch: bytes.subarray(0, maxBytes).toString("utf8").replace(/\uFFFD+$/, ""), truncated: true };
  }

  commitsSince(repo: string, sha: string, branch: string): number | undefined {
    if (!this.exists(repo, branch) || !this.ok(repo, ["cat-file", "-e", `${sha}^{commit}`])) return undefined;
    const count = Number(this.git(repo, ["rev-list", "--count", `${sha}..refs/heads/${branch}`]));
    return Number.isFinite(count) ? count : undefined;
  }

  remoteBranches(repo: string): string[] {
    if (!this.ok(repo, ["remote", "get-url", "origin"])) throw new Error("The repository has no 'origin' remote");
    try {
      const out = execFileSync("git", [...this.gitArgs, "ls-remote", "--heads", "origin"], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
      return out
        .split("\n")
        .map((line) => /\trefs\/heads\/(.+)$/.exec(line)?.[1])
        .filter((name): name is string => name !== undefined)
        .sort();
    } catch (err) {
      throw new Error(`Could not ask origin which branches it has: ${String((err as { stderr?: Buffer | string }).stderr ?? "").trim() || "git ls-remote failed"}`);
    }
  }

  onOrigin(repo: string, branch: string): boolean {
    try {
      execFileSync("git", [...this.gitArgs, "ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${branch}`], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return true;
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer | string };
      // `--exit-code` answers 2 when the remote is fine and has no such branch; anything else is a failure to ask.
      if (e.status === 2) return false;
      throw new Error(`Could not ask origin which branches it has: ${String(e.stderr ?? "").trim() || "git ls-remote failed"}`);
    }
  }

  push(ref: BranchRef): void {
    if (!this.ok(ref.repo, ["remote", "get-url", "origin"])) throw new Error("The repository has no 'origin' remote to push to");
    if (!this.exists(ref.repo, ref.branch)) throw new Error(`The branch ${ref.branch} no longer exists`);
    // No --force, ever: if the remote branch moved on, the push is rejected and the remote is left as it was.
    this.git(ref.repo, ["push", "-u", "origin", `refs/heads/${ref.branch}:refs/heads/${ref.branch}`]);
  }

  /** In a worktree the branch must be the one checked out there; otherwise the edit would hit another branch. */
  private requireOnBranch(ref: BranchRef): void {
    const current = this.git(ref.worktree!, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (current !== ref.branch) throw new Error(`The worktree is on '${current}', not on ${ref.branch}`);
  }

  private requireFree(ref: BranchRef): void {
    const at = this.checkedOutAt(ref.repo, ref.branch);
    if (at !== undefined) throw new Error(`${ref.branch} is checked out at ${at}`);
  }

  revert(ref: BranchRef): { sha: string } {
    if (!this.exists(ref.repo, ref.branch)) throw new Error(`The branch ${ref.branch} no longer exists`);
    const message = `revert: undo the changes of ${ref.branch}`;
    if (this.hasWorktree(ref)) {
      const wt = ref.worktree!;
      this.requireOnBranch(ref);
      if (this.git(wt, ["status", "--porcelain"]) !== "") throw new Error("The worktree has uncommitted changes");
      this.git(wt, ["restore", `--source=${ref.startSha}`, "--staged", "--worktree", "--", "."]);
      if (this.ok(wt, ["diff", "--cached", "--quiet"])) throw new Error(`${ref.branch} is already identical to its start`);
      this.git(wt, ["commit", "-q", "-m", message]);
      return { sha: this.git(wt, ["rev-parse", "HEAD"]) };
    }
    this.requireFree(ref);
    const head = this.git(ref.repo, ["rev-parse", `refs/heads/${ref.branch}`]);
    const tree = this.git(ref.repo, ["rev-parse", `${ref.startSha}^{tree}`]);
    if (tree === this.git(ref.repo, ["rev-parse", `${head}^{tree}`])) throw new Error(`${ref.branch} is already identical to its start`);
    const sha = this.git(ref.repo, ["commit-tree", tree, "-p", head, "-m", message]);
    // The old value makes the move fail if the branch changed in the meantime.
    this.git(ref.repo, ["update-ref", `refs/heads/${ref.branch}`, sha, head]);
    return { sha };
  }

  reset(ref: BranchRef): void {
    if (!this.exists(ref.repo, ref.branch)) throw new Error(`The branch ${ref.branch} no longer exists`);
    if (this.hasWorktree(ref)) {
      this.requireOnBranch(ref);
      this.git(ref.worktree!, ["reset", "-q", "--hard", ref.startSha]);
      this.git(ref.worktree!, ["clean", "-fdq"]);
      return;
    }
    this.requireFree(ref);
    this.git(ref.repo, ["update-ref", `refs/heads/${ref.branch}`, ref.startSha]);
  }

  remove(ref: BranchRef): void {
    const at = this.exists(ref.repo, ref.branch) ? this.checkedOutAt(ref.repo, ref.branch) : undefined;
    if (at !== undefined && at !== ref.worktree) throw new Error(`${ref.branch} is checked out at ${at}`);
    if (ref.worktree !== undefined && existsSync(ref.worktree)) {
      this.ok(ref.repo, ["worktree", "remove", "--force", ref.worktree]);
      rmSync(ref.worktree, { recursive: true, force: true });
    }
    this.ok(ref.repo, ["worktree", "prune"]);
    if (this.exists(ref.repo, ref.branch)) this.git(ref.repo, ["branch", "-D", ref.branch]);
  }
}

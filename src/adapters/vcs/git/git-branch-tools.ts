import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { BranchEditor, BranchInspector, BranchRef, BranchState } from "../../../core/ports/branch-tools.js";

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
      pushed: this.ok(ref.repo, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${ref.branch}`]),
      hasWorktree,
      dirty: hasWorktree && this.git(ref.worktree!, ["status", "--porcelain"]) !== "",
    };
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

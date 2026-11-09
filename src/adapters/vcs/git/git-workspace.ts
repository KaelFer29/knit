import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  AttachWorkspaceInput,
  BaseRef,
  CommitInfo,
  GitInspection,
  PrepareWorkspaceInput,
  RestoreWorkspaceInput,
  TaskWorkspace,
  Workspace,
} from "../../../core/ports/workspace.js";
import { listChangedPaths, listChangedSince, newEntries, snapshotDir } from "./changes.js";

export interface GitWorkspaceOptions {
  /** Directory holding all worktrees: <root>/<runId>/<taskId>/repo */
  root: string;
  /** Extra args placed before every git subcommand (e.g. `-c core.hooksPath=...` in tests). */
  gitArgs?: string[];
}

const FIELD = "\x1f";
const RECORD = "\x1e";

/**
 * One git worktree per task, at <root>/<runId>/<taskId>/repo, on the branch named in the plan.
 * The parent directory of the worktree is dedicated to the task, so anything the agent writes
 * next to the worktree (e.g. `../x.txt`) shows up as a new entry there.
 */
export class GitWorkspace implements Workspace {
  private readonly gitArgs: string[];
  private readonly baselines = new Map<string, { parent: string; entries: Set<string> }>();

  constructor(private readonly options: GitWorkspaceOptions) {
    this.gitArgs = options.gitArgs ?? [];
  }

  private git(cwd: string, args: string[]): string {
    try {
      return execFileSync("git", [...this.gitArgs, ...args], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      }).trim();
    } catch (err) {
      const e = err as { stderr?: Buffer | string; message: string };
      const detail = (e.stderr ? e.stderr.toString() : e.message).trim();
      throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${detail}`);
    }
  }

  private gitOk(cwd: string, args: string[]): boolean {
    try {
      this.git(cwd, args);
      return true;
    } catch {
      return false;
    }
  }

  private branchExists(repo: string, branch: string): boolean {
    return this.gitOk(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  }

  resolveBase(repo: string, base?: string): BaseRef {
    const ref = base ?? "HEAD";
    let sha: string;
    try {
      sha = this.git(repo, ["rev-parse", "--verify", `${ref}^{commit}`]);
    } catch {
      throw new Error(`Cannot resolve base '${ref}' in ${repo}`);
    }
    let branch: string | undefined;
    if (base === undefined) {
      try {
        branch = this.git(repo, ["symbolic-ref", "--short", "-q", "HEAD"]) || undefined;
      } catch {
        branch = undefined; // detached HEAD
      }
    } else if (this.branchExists(repo, base)) {
      branch = base;
    }
    return { sha, ...(branch ? { branch } : {}) };
  }

  prepare(input: PrepareWorkspaceInput): TaskWorkspace {
    if (this.branchExists(input.repo, input.branch)) {
      throw new Error(
        `Branch '${input.branch}' already exists in ${input.repo}. Delete it or choose another name in the plan.`,
      );
    }
    const parent = join(this.options.root, input.runId, input.taskId);
    const path = join(parent, "repo");
    mkdirSync(parent, { recursive: true });
    try {
      this.git(input.repo, ["worktree", "add", "-b", input.branch, path, input.startPoint]);
    } catch (err) {
      rmSync(parent, { recursive: true, force: true });
      throw err;
    }
    this.baselines.set(path, { parent, entries: snapshotDir(parent) });
    const startSha = this.git(path, ["rev-parse", "HEAD"]);
    return { path, branch: input.branch, startSha };
  }

  attach(input: AttachWorkspaceInput): TaskWorkspace | undefined {
    if (!existsSync(join(input.path, ".git"))) return undefined;
    const parent = dirname(input.path);
    this.baselines.set(input.path, { parent, entries: snapshotDir(parent) });
    return { path: input.path, branch: input.branch, startSha: input.startSha };
  }

  /** Where the branch is checked out, in the main checkout or any worktree. */
  private checkedOutAt(repo: string, branch: string): string | undefined {
    let path: string | undefined;
    for (const line of this.git(repo, ["worktree", "list", "--porcelain"]).split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line === `branch refs/heads/${branch}`) return path;
    }
    return undefined;
  }

  restore(input: RestoreWorkspaceInput): TaskWorkspace {
    if (!this.branchExists(input.repo, input.branch)) {
      throw new Error(`The branch ${input.branch} no longer exists in ${input.repo}, so the worktree of the task cannot be recreated.`);
    }
    // A folder deleted by hand leaves a registration that would make `worktree add` refuse.
    this.gitOk(input.repo, ["worktree", "prune"]);
    const at = this.checkedOutAt(input.repo, input.branch);
    if (at !== undefined) {
      throw new Error(`${input.branch} is checked out at ${at}. Switch that checkout to another branch (git checkout <other>) and try again: a branch can only be checked out in one place.`);
    }
    const parent = dirname(input.path);
    mkdirSync(parent, { recursive: true });
    this.git(input.repo, ["worktree", "add", input.path, input.branch]);
    this.baselines.set(input.path, { parent, entries: snapshotDir(parent) });
    return { path: input.path, branch: input.branch, startSha: input.startSha };
  }

  changedPaths(ws: TaskWorkspace): string[] {
    return listChangedSince(ws.path, ws.startSha);
  }

  outsideChanges(ws: TaskWorkspace): string[] {
    const baseline = this.baselines.get(ws.path);
    if (!baseline) throw new Error(`Workspace not prepared by this instance: ${ws.path}`);
    return newEntries(baseline.entries, snapshotDir(baseline.parent)).map((name) => `../${name}`);
  }

  inspect(ws: TaskWorkspace): GitInspection {
    const branch = this.git(ws.path, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const historyIntact = this.gitOk(ws.path, ["merge-base", "--is-ancestor", ws.startSha, "HEAD"]);
    const log = this.git(ws.path, [
      "log",
      "--reverse",
      `--format=%H${FIELD}%s${FIELD}%b${RECORD}`,
      `${ws.startSha}..HEAD`,
    ]);
    const commits: CommitInfo[] = log
      .split(RECORD)
      .map((chunk) => chunk.replace(/^\n/, ""))
      .filter((chunk) => chunk.trim() !== "")
      .map((chunk) => {
        const [sha = "", subject = "", body = ""] = chunk.split(FIELD);
        return { sha, subject, body: body.trim() };
      });
    return { branch, historyIntact, commits, uncommitted: listChangedPaths(ws.path) };
  }

  hasBranch(repo: string, branch: string): boolean {
    return this.branchExists(repo, branch);
  }

  /** Removes a task worktree, even with uncommitted work. Tolerates one that is already gone. */
  removeWorktree(repo: string, path: string): void {
    if (existsSync(path)) {
      this.gitOk(repo, ["worktree", "remove", "--force", path]);
      rmSync(path, { recursive: true, force: true });
    }
    this.gitOk(repo, ["worktree", "prune"]);
  }

  /** Safe delete (`git branch -d`): only succeeds when the branch is merged. */
  deleteBranch(repo: string, branch: string): boolean {
    return this.gitOk(repo, ["branch", "-d", branch]);
  }

  push(ws: TaskWorkspace): void {
    this.git(ws.path, ["push", "-u", "origin", ws.branch]);
  }
}

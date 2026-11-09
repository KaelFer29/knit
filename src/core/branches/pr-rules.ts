import type { BranchState } from "../ports/branch-tools.js";
import { prBaseOf, type PrTaskRef } from "./pr-draft.js";

/** What the pull request a task already has says about opening another. */
export interface PriorPr {
  state: "open" | "merged" | "closed";
  /** Commits the branch has past the commit that pull request ended at; absent when not known. */
  newCommits?: number;
}

export interface PrContext {
  runStatus: string;
  /** How the run recorded its base, `<branch>@<sha>`. */
  runBase: string;
  task: PrTaskRef & { status: string; prUrl?: string };
  tasks: PrTaskRef[];
  state: BranchState;
  /** State of the parent's branch when the task depends on another. */
  parentState: BranchState | undefined;
  /** A branch the person chose to target instead of the recommended one. */
  requestedBase?: string;
  /** The state of the pull request the task already has, when it has one and it could be read. */
  prior?: PriorPr;
}

export type PrDecision = { ok: true; base: string; head: string; /** Branches worth suggesting as a target, the recommended one first. */ options: string[]; effects: string[] } | { ok: false; reason: string };

const MAX_BRANCH = 200;

/** A branch name that is safe to hand to git and gh: no spaces, no leading dash, no `..`, `//`, `@{`, trailing `/`, `.` or `.lock`. */
export function isBranchName(name: string): boolean {
  return name.length <= MAX_BRANCH && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) && !name.includes("..") && !name.includes("//") && !/(\/|\.|\.lock)$/.test(name);
}

/** Whether a task's branch may become a pull request and where it would go. Pure; the CLI and the web interface share it. */
export function decidePr(ctx: PrContext): PrDecision {
  const { task, state } = ctx;
  if (ctx.runStatus === "running") return { ok: false, reason: "The run is still running. Abort it first." };
  if (task.branch === undefined) return { ok: false, reason: `${task.taskId} has no branch.` };
  if (task.status !== "passed") return { ok: false, reason: `${task.taskId} did not pass its checks. A pull request is only opened for work that passed.` };
  // A merged or closed pull request does not carry what a follow-up added after it, so the branch may open another.
  const another = ctx.prior !== undefined && ctx.prior.state !== "open" && (ctx.prior.newCommits ?? 0) > 0;
  if (task.prUrl !== undefined && !another) return { ok: false, reason: `${task.taskId} already has a pull request: ${task.prUrl}` };
  if (!state.exists) return { ok: false, reason: `The branch ${task.branch} no longer exists.` };
  if (state.ahead.length === 0) return { ok: false, reason: `${task.branch} has no commits after the start, so there is nothing to open a pull request for.` };
  if (state.dirty) return { ok: false, reason: "The worktree has uncommitted changes that the pull request would leave out. Commit or discard them first." };

  const base = prBaseOf(ctx.runBase, task, ctx.tasks);
  if (!base.ok) return base;
  const requested = ctx.requestedBase;
  if (requested !== undefined) {
    if (!isBranchName(requested)) return { ok: false, reason: `"${requested.slice(0, 60)}" is not a valid branch name to open the pull request into.` };
    if (requested === task.branch) return { ok: false, reason: "A pull request cannot go into its own branch." };
  }
  const target = requested ?? base.base;
  if (target === base.parent?.branch && !(ctx.parentState?.pushed ?? false)) {
    return { ok: false, reason: `${base.parent.taskId} is not on origin yet. Open its pull request first: GitHub needs the base branch (${base.parent.branch}) there.` };
  }
  // What the person can pick from: where the rules would send it, where the run started, and the other tasks' branches.
  const runBranch = prBaseOf(ctx.runBase, { taskId: task.taskId, branch: task.branch }, ctx.tasks);
  const options = [base.base, ...(runBranch.ok ? [runBranch.base] : []), ...ctx.tasks.flatMap((t) => (t.branch === undefined ? [] : [t.branch]))].filter((b, i, all) => b !== task.branch && all.indexOf(b) === i);
  return {
    ok: true,
    base: target,
    head: task.branch,
    options,
    effects: [
      state.pushed ? `${task.branch} is already on origin: it is pushed again only to bring it up to date, never forced.` : `Pushes ${task.branch} to origin, without forcing.`,
      `Opens a pull request from ${task.branch} into ${target}.`,
      ...(task.prUrl !== undefined && ctx.prior?.newCommits !== undefined ? [`${ctx.prior.newCommits} new ${ctx.prior.newCommits === 1 ? "commit" : "commits"} since the previous pull request, which was ${ctx.prior.state}.`] : []),
    ],
  };
}

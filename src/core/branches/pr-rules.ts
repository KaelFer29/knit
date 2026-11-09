import type { BranchState } from "../ports/branch-tools.js";
import { prBaseOf, type PrTaskRef } from "./pr-draft.js";

export interface PrContext {
  runStatus: string;
  /** How the run recorded its base, `<branch>@<sha>`. */
  runBase: string;
  task: PrTaskRef & { status: string; prUrl?: string };
  tasks: PrTaskRef[];
  state: BranchState;
  /** State of the parent's branch when the task depends on another. */
  parentState: BranchState | undefined;
}

export type PrDecision = { ok: true; base: string; head: string; effects: string[] } | { ok: false; reason: string };

/** Whether a task's branch may become a pull request and where it would go. Pure; the CLI and the web interface share it. */
export function decidePr(ctx: PrContext): PrDecision {
  const { task, state } = ctx;
  if (ctx.runStatus === "running") return { ok: false, reason: "The run is still running. Abort it first." };
  if (task.branch === undefined) return { ok: false, reason: `${task.taskId} has no branch.` };
  if (task.status !== "passed") return { ok: false, reason: `${task.taskId} did not pass its checks. A pull request is only opened for work that passed.` };
  if (task.prUrl !== undefined) return { ok: false, reason: `${task.taskId} already has a pull request: ${task.prUrl}` };
  if (!state.exists) return { ok: false, reason: `The branch ${task.branch} no longer exists.` };
  if (state.ahead.length === 0) return { ok: false, reason: `${task.branch} has no commits after the start, so there is nothing to open a pull request for.` };
  if (state.dirty) return { ok: false, reason: "The worktree has uncommitted changes that the pull request would leave out. Commit or discard them first." };

  const base = prBaseOf(ctx.runBase, task, ctx.tasks);
  if (!base.ok) return base;
  if (base.parent !== undefined && !(ctx.parentState?.pushed ?? false)) {
    return { ok: false, reason: `${base.parent.taskId} is not on origin yet. Open its pull request first: GitHub needs the base branch (${base.parent.branch}) there.` };
  }
  return {
    ok: true,
    base: base.base,
    head: task.branch,
    effects: [`Pushes ${task.branch} to origin, without forcing.`, `Opens a pull request from ${task.branch} into ${base.base}.`],
  };
}

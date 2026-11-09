import type { BranchState } from "../ports/branch-tools.js";

export interface CheckoutContext {
  /** Status of the run the task belongs to. */
  runStatus: string;
  task: { taskId: string; branch?: string; startSha?: string };
  state: BranchState;
  /** The branch the run started from, to say where to go back to before iterating; absent when the run did not start from a branch. */
  baseBranch?: string | undefined;
}

export type CheckoutDecision = { ok: true; effects: string[] } | { ok: false; reason: string };

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Whether the user's repository can be switched to a task's branch to test it, and what that does, in plain sentences
 * the person confirms. Pure. A branch lives in one place at a time, so the task's worktree has to go first; the branch
 * and its commits stay. The cleanliness of the user's repository is checked when the action runs, not here.
 */
export function decideCheckout(ctx: CheckoutContext): CheckoutDecision {
  const { task, state } = ctx;
  if (ctx.runStatus === "running") return { ok: false, reason: "The run is still running. Abort it first." };
  if (task.branch === undefined || task.startSha === undefined) return { ok: false, reason: `${task.taskId} has no branch to test.` };
  if (!state.exists) return { ok: false, reason: `The branch ${task.branch} no longer exists.` };
  if (state.checkedOut) return { ok: false, reason: `Your repository is already on ${task.branch}.` };
  if (state.dirty) return { ok: false, reason: "The worktree has uncommitted changes. Commit or discard them first, so removing it loses nothing." };

  const effects: string[] = [];
  if (state.hasWorktree) effects.push(`Removes the worktree of ${task.taskId}. The branch ${task.branch} and its ${plural(state.ahead.length, "commit")} stay.`);
  effects.push(`Switches your repository to ${task.branch}, so you can test it there. Your repository must have no uncommitted changes.`);
  effects.push(
    ctx.baseBranch === undefined
      ? `To iterate on ${task.taskId} again, switch your repository back to another branch first: a branch can only be checked out in one place.`
      : `To iterate on ${task.taskId} again, switch back first (git checkout ${ctx.baseBranch}): a branch can only be checked out in one place.`,
  );
  return { ok: true, effects };
}

import type { BranchState, UndoMode } from "../ports/branch-tools.js";

export interface UndoContext {
  /** Status of the run the task belongs to. */
  runStatus: string;
  mode: UndoMode;
  task: { taskId: string; branch?: string; startSha?: string };
  state: BranchState;
  /** Tasks stacked on this one (their `Depends`) whose branch still exists. */
  dependents: { taskId: string; branch: string }[];
}

export type UndoDecision = { ok: true; effects: string[] } | { ok: false; reason: string };

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * What may be undone and what each action costs, in plain sentences the person confirms. Pure: it reads the state it is
 * given and decides. Revert is the safe one (history stays); reset and delete lose commits from the branch.
 */
export function decideUndo(ctx: UndoContext): UndoDecision {
  const { mode, task, state, dependents } = ctx;
  if (ctx.runStatus === "running") return { ok: false, reason: "The run is still running. Abort it first." };
  if (task.branch === undefined || task.startSha === undefined) return { ok: false, reason: `${task.taskId} has not started, so there is nothing to undo.` };
  if (!state.exists) return { ok: false, reason: `The branch ${task.branch} no longer exists.` };

  if ((mode === "revert" || mode === "reset") && !state.historyIntact) {
    return { ok: false, reason: `The history of ${task.branch} was rewritten, so its start commit is not on it any more. Delete the branch instead.` };
  }
  if (mode === "revert" || mode === "reset") {
    if (state.ahead.length === 0 && !state.dirty) return { ok: false, reason: `${task.branch} has no commits after the start, so there is nothing to undo.` };
  }
  if (mode === "revert" && state.dirty) {
    return { ok: false, reason: "The worktree has uncommitted changes. Commit or discard them first, so they are not mixed into the revert." };
  }
  if ((mode === "reset" || mode === "delete") && dependents.length > 0) {
    const names = dependents.map((d) => `${d.taskId} (${d.branch})`).join(", ");
    return { ok: false, reason: `${names} ${dependents.length === 1 ? "is" : "are"} stacked on ${task.branch}. Undo ${dependents.length === 1 ? "it" : "them"} first.` };
  }

  const effects: string[] = [];
  const commits = plural(state.ahead.length, "commit");
  if (mode === "revert") {
    effects.push(`Adds one commit to ${task.branch} that restores the code to how it was before the task. Nothing is lost: the history stays.`);
  } else if (mode === "reset") {
    effects.push(`Moves ${task.branch} back to the commit the task started from. ${commits} leave${state.ahead.length === 1 ? "s" : ""} the branch.`);
    if (state.dirty) effects.push("Uncommitted changes in the worktree are discarded.");
  } else {
    effects.push(`Deletes the branch ${task.branch} and its worktree.`);
    if (state.ahead.length > 0) effects.push(`${commits} of the task ${state.ahead.length === 1 ? "is" : "are"} lost from this repository (git's reflog keeps them for a while).`);
    if (state.dirty) effects.push("Uncommitted changes in the worktree are discarded.");
  }
  if (state.pushed) effects.push(`The copy on origin is not touched.`);
  return { ok: true, effects };
}

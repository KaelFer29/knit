/** A branch Knit switched the user's repository to, and the task it belongs to. */
export interface ReturnTarget {
  taskId: string;
  /** The branch the repository was on before Knit switched it. */
  branch: string;
}

/** The slice of a stored event this reads. */
export interface ReturnEvent {
  type: string;
  taskId?: string | undefined;
  payload?: unknown;
}

export type ReturnDecision = { ok: true; effects: string[] } | { ok: false; reason: string };

/**
 * The branch the user's repository should go back to: the last checkout Knit made, unless it was given back since.
 * Pure. A checkout that recorded no previous branch (the repository was detached) leaves nothing to return to.
 */
export function returnTargetOf(events: readonly ReturnEvent[]): ReturnTarget | undefined {
  let target: ReturnTarget | undefined;
  for (const event of events) {
    if (event.type === "branch.checked_out") {
      const from = (event.payload as { from?: unknown } | undefined)?.from;
      target = event.taskId !== undefined && typeof from === "string" && from !== "" ? { taskId: event.taskId, branch: from } : undefined;
    } else if (event.type === "branch.returned") {
      target = undefined;
    }
  }
  return target;
}

/**
 * Whether the user's repository can be switched back to the branch it was on before Knit tested a task, and what that
 * does. Pure: the repository's own state (uncommitted changes, already there) is checked when the action runs.
 */
export function decideReturn(ctx: { runStatus: string; target: ReturnTarget | undefined; taskBranch?: string | undefined }): ReturnDecision {
  if (ctx.runStatus === "running") return { ok: false, reason: "The run is still running. Wait for it to finish first." };
  if (ctx.target === undefined) return { ok: false, reason: "Knit has not switched your repository, so there is no branch to return it to." };
  const effects = [`Switches your repository back to ${ctx.target.branch}. It must have no uncommitted changes.`];
  if (ctx.taskBranch !== undefined) effects.push(`${ctx.taskBranch} and its commits stay; the next iteration recreates the worktree of ${ctx.target.taskId}.`);
  return { ok: true, effects };
}

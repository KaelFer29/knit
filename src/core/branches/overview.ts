import type { BranchState } from "../ports/branch-tools.js";
import { decideCheckout, type CheckoutDecision } from "./checkout-rules.js";
import { decidePr, type PrDecision } from "./pr-rules.js";
import { decideUndo, type UndoDecision } from "./undo-rules.js";

export interface BranchTask {
  taskId: string;
  title: string;
  status: string;
  branch?: string;
  startSha?: string;
  dependsOn?: string;
  prUrl?: string;
}

export interface BranchOverview {
  taskId: string;
  title: string;
  status: string;
  branch: string;
  startSha: string;
  prUrl?: string;
  state: BranchState;
  /** What each way of undoing would do, or why it cannot be done now. */
  undo: { revert: UndoDecision; reset: UndoDecision; delete: UndoDecision };
  /** Whether a pull request can be opened and where it would go. */
  pr: PrDecision;
  /** Whether the user's repository can be switched to this branch to test it, and what that does. */
  checkout: CheckoutDecision;
}

/**
 * Every task that has a branch, with its state and the decision for each action. Pure: the caller supplies how a
 * branch is read, so the command line and the web interface decide exactly the same.
 */
export function describeBranches(
  run: { status: string; base: string },
  tasks: BranchTask[],
  stateOf: (task: BranchTask) => BranchState,
  /** A branch the person chose for one task's pull request, in place of the recommended one. */
  requested?: { taskId: string; base: string },
): BranchOverview[] {
  const states = new Map<string, BranchState>();
  const read = (task: BranchTask): BranchState => {
    let s = states.get(task.taskId);
    if (s === undefined) {
      s = stateOf(task);
      states.set(task.taskId, s);
    }
    return s;
  };
  const refs = tasks.map((t) => ({ taskId: t.taskId, ...(t.branch ? { branch: t.branch } : {}), ...(t.dependsOn ? { dependsOn: t.dependsOn } : {}) }));

  // The branch the run started from (`<branch>@<sha>`), to say where to go back to before iterating on a task again.
  const at = run.base.lastIndexOf("@");
  const baseName = (at === -1 ? "" : run.base.slice(0, at)).trim();
  const baseBranch = baseName === "" || baseName === "HEAD" ? undefined : baseName;

  return tasks.flatMap((task): BranchOverview[] => {
    if (task.branch === undefined || task.startSha === undefined) return [];
    const state = read(task);
    const dependents = tasks
      .filter((d) => d.dependsOn === task.taskId && d.branch !== undefined && d.startSha !== undefined && read(d).exists)
      .map((d) => ({ taskId: d.taskId, branch: d.branch! }));
    const undoFor = (mode: "revert" | "reset" | "delete"): UndoDecision =>
      decideUndo({ runStatus: run.status, mode, task: { taskId: task.taskId, branch: task.branch, startSha: task.startSha }, state, dependents });
    const parent = task.dependsOn === undefined ? undefined : tasks.find((p) => p.taskId === task.dependsOn);
    return [
      {
        taskId: task.taskId,
        title: task.title,
        status: task.status,
        branch: task.branch,
        startSha: task.startSha,
        ...(task.prUrl ? { prUrl: task.prUrl } : {}),
        state,
        undo: { revert: undoFor("revert"), reset: undoFor("reset"), delete: undoFor("delete") },
        checkout: decideCheckout({ runStatus: run.status, task: { taskId: task.taskId, branch: task.branch, startSha: task.startSha }, state, baseBranch }),
        pr: decidePr({
          runStatus: run.status,
          runBase: run.base,
          task: { taskId: task.taskId, status: task.status, branch: task.branch, ...(task.dependsOn ? { dependsOn: task.dependsOn } : {}), ...(task.prUrl ? { prUrl: task.prUrl } : {}) },
          tasks: refs,
          state,
          parentState: parent && parent.branch !== undefined && parent.startSha !== undefined ? read(parent) : undefined,
          ...(requested?.taskId === task.taskId ? { requestedBase: requested.base } : {}),
        }),
      },
    ];
  });
}

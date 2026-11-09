import { resolve, sep } from "node:path";
import { GitBranchTools } from "../../adapters/vcs/git/git-branch-tools.js";
import { decideUndo } from "../../core/branches/undo-rules.js";
import type { BranchRef, UndoMode } from "../../core/ports/branch-tools.js";
import { UsageError } from "../errors.js";
import { parse } from "../support/args.js";
import { dataDirOf, openStoreIfExists } from "../support/paths.js";
import type { CliDeps, CliIo } from "../types.js";

const MODES: readonly UndoMode[] = ["revert", "reset", "delete"];

/** Prints one JSON line (for the web interface) or the human lines. */
function report(io: CliIo, json: boolean, body: Record<string, unknown>, human: string[]): void {
  io.out(json ? `${JSON.stringify(body)}\n` : `${human.join("\n")}\n`);
}

/**
 * Works on the branch a run's task created. `undo` takes the branch back (revert, reset or delete); without `--yes` it
 * only says what it would do. Nothing here ever touches a remote.
 */
export function branchCommand(args: string[], io: CliIo, deps: CliDeps, env: NodeJS.ProcessEnv): number {
  const { values, positionals } = parse(args, {
    "data-dir": { type: "string" },
    mode: { type: "string" },
    yes: { type: "boolean" },
    json: { type: "boolean" },
  });
  const [runId, taskId, action] = positionals;
  if (positionals.length !== 3 || runId === undefined || taskId === undefined) throw new UsageError("branch needs a run id, a task id and an action (undo)");
  if (action !== "undo") throw new UsageError(`Unknown branch action: ${action}. Use: undo`);
  const mode = values.mode as UndoMode | undefined;
  if (mode === undefined || !MODES.includes(mode)) throw new UsageError(`undo needs --mode ${MODES.join("|")}`);
  const json = values.json === true;

  const store = openStoreIfExists(env, values["data-dir"]);
  const detail = store?.getRun(runId);
  if (!store || !detail) {
    store?.close();
    io.err(`Run not found: ${runId}\n`);
    return 1;
  }
  try {
    const task = detail.tasks.find((t) => t.taskId === taskId);
    if (!task) {
      io.err(`Task not found: ${taskId}\n`);
      return 1;
    }
    const tools = new GitBranchTools(deps.gitArgs ? { gitArgs: deps.gitArgs } : {});
    // A worktree the run does not own is never touched: the path comes from the database, so it is checked.
    const runDir = resolve(dataDirOf({ "data-dir": values["data-dir"] }, env), "worktrees", runId) + sep;
    const ownsWorktree = (path: string | undefined): path is string => path !== undefined && resolve(path).startsWith(runDir);
    const refOf = (t: { branch?: string; startSha?: string; worktree?: string }): BranchRef | undefined =>
      t.branch === undefined || t.startSha === undefined
        ? undefined
        : { repo: detail.run.repo, branch: t.branch, startSha: t.startSha, ...(ownsWorktree(t.worktree) ? { worktree: t.worktree } : {}) };

    const ref = refOf(task);
    const state = ref ? tools.state(ref) : { exists: false, historyIntact: true, ahead: [], pushed: false, hasWorktree: false, dirty: false };
    const dependents = detail.tasks
      .filter((t) => t.dependsOn === taskId && t.branch !== undefined)
      .filter((t) => {
        const r = refOf(t);
        return r !== undefined && tools.state(r).exists;
      })
      .map((t) => ({ taskId: t.taskId, branch: t.branch! }));

    const decision = decideUndo({
      runStatus: detail.run.status,
      mode,
      task: { taskId, ...(task.branch ? { branch: task.branch } : {}), ...(task.startSha ? { startSha: task.startSha } : {}) },
      state,
      dependents,
    });
    if (!decision.ok) {
      report(io, json, { ok: false, reason: decision.reason }, [decision.reason]);
      return 1;
    }
    if (values.yes !== true) {
      report(io, json, { ok: true, dryRun: true, mode, branch: task.branch, effects: decision.effects }, [...decision.effects, "Nothing was changed. Repeat with --yes to do it."]);
      return 0;
    }

    let sha: string | undefined;
    try {
      if (mode === "revert") sha = tools.revert(ref!).sha;
      else if (mode === "reset") tools.reset(ref!);
      else tools.remove(ref!);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      report(io, json, { ok: false, reason }, [reason]);
      return 1;
    }
    store.recordEvent({ runId, taskId, ts: (deps.now?.() ?? new Date()).toISOString(), type: "branch.undone", payload: { mode, branch: task.branch, ...(sha ? { sha } : {}) } });
    report(io, json, { ok: true, dryRun: false, mode, branch: task.branch, effects: decision.effects, ...(sha ? { sha } : {}) }, [...decision.effects, "Done."]);
    return 0;
  } finally {
    store.close();
  }
}

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SqliteRunStore } from "../../adapters/storage/sqlite/run-store.js";
import { CursorAgentRunner } from "../../adapters/agents/cursor/cursor-runner.js";
import { isModelId } from "../../core/plan/parse-plan.js";
import { GitBranchTools } from "../../adapters/vcs/git/git-branch-tools.js";
import { GhPullRequests } from "../../adapters/vcs/github/gh-pull-requests.js";
import { buildPrDraftPrompt, parsePrDraft } from "../../core/branches/pr-draft.js";
import { describeBranches, type BranchOverview } from "../../core/branches/overview.js";
import type { BranchRef, BranchState, UndoMode } from "../../core/ports/branch-tools.js";
import type { TaskRecord } from "../../core/ports/run-store.js";
import { UsageError } from "../errors.js";
import { parse } from "../support/args.js";
import { ownsWorktree } from "../support/owns-worktree.js";
import { dataDirOf, openStoreIfExists } from "../support/paths.js";
import type { CliDeps, CliIo } from "../types.js";

const MODES: readonly UndoMode[] = ["revert", "reset", "delete"];
const ACTIONS = ["undo", "pr-draft", "pr"] as const;
/** The cheap, fast model that drafts a pull request's text. */
export const PR_DRAFT_MODEL = "composer-2.5-fast";
const PR_DRAFT_TIMEOUT_MS = 120_000;
/** How much of the diff the model is shown. */
const PR_DRAFT_DIFF_BYTES = 30_000;
const MAX_TITLE = 200;
const MAX_BODY = 60_000;

const NONE: BranchState = { exists: false, historyIntact: true, ahead: [], pushed: false, hasWorktree: false, dirty: false };

/** Prints one JSON line (for the web interface) or the human lines. */
function report(io: CliIo, json: boolean, body: Record<string, unknown>, human: string[]): void {
  io.out(json ? `${JSON.stringify(body)}\n` : `${human.join("\n")}\n`);
}

const fail = (io: CliIo, json: boolean, reason: string): number => {
  report(io, json, { ok: false, reason }, [reason]);
  return 1;
};

/**
 * Works on the branch a run's task created: `undo` takes it back (revert, reset or delete), `pr-draft` has a cheap model
 * write the text of a pull request and `pr` pushes the branch and opens it. Without `--yes`, `undo` only says what it
 * would do. Nothing here forces a push or touches anything on a remote beyond that push.
 */
export async function branchCommand(args: string[], io: CliIo, deps: CliDeps, env: NodeJS.ProcessEnv): Promise<number> {
  const { values, positionals } = parse(args, {
    "data-dir": { type: "string" },
    mode: { type: "string" },
    yes: { type: "boolean" },
    json: { type: "boolean" },
    model: { type: "string" },
    title: { type: "string" },
    body: { type: "string" },
  });
  const [runId, taskId, action] = positionals;
  if (positionals.length !== 3 || runId === undefined || taskId === undefined) throw new UsageError(`branch needs a run id, a task id and an action (${ACTIONS.join(", ")})`);
  if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) throw new UsageError(`Unknown branch action: ${action}. Use: ${ACTIONS.join(", ")}`);
  const json = values.json === true;

  // Everything that can be a usage mistake is checked before the database is opened.
  const mode = values.mode as UndoMode | undefined;
  if (action === "undo" && (mode === undefined || !MODES.includes(mode))) throw new UsageError(`undo needs --mode ${MODES.join("|")}`);
  if (values.model !== undefined && !isModelId(values.model)) throw new UsageError("--model must be an id from 'agent models': no spaces, and it cannot start with a dash");
  if (action === "pr") {
    if (values.title === undefined || values.body === undefined) throw new UsageError("pr needs --title and --body");
    if (values.title.trim() === "" || /[\r\n]/.test(values.title) || values.title.length > MAX_TITLE) throw new UsageError(`--title must be one line of at most ${MAX_TITLE} characters`);
    if (values.body.length > MAX_BODY) throw new UsageError(`--body must be at most ${MAX_BODY} characters`);
  }

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
    const runDir = resolve(dataDirOf({ "data-dir": values["data-dir"] }, env), "worktrees", runId);
    const refOf = (t: TaskRecord): BranchRef | undefined =>
      t.branch === undefined || t.startSha === undefined
        ? undefined
        : { repo: detail.run.repo, branch: t.branch, startSha: t.startSha, ...(t.worktree !== undefined && ownsWorktree(t.worktree, runDir) ? { worktree: t.worktree } : {}) };
    const stateOf = (t: TaskRecord): BranchState => {
      const ref = refOf(t);
      return ref ? tools.state(ref) : NONE;
    };
    const ref = refOf(task);
    const now = (): string => (deps.now?.() ?? new Date()).toISOString();
    // The same decisions the web interface shows: one function reads every branch and decides each action.
    const overview = describeBranches(
      { status: detail.run.status, base: detail.run.base },
      detail.tasks.map((t) => ({ taskId: t.taskId, title: t.title, status: t.status, ...(t.branch ? { branch: t.branch } : {}), ...(t.startSha ? { startSha: t.startSha } : {}), ...(t.dependsOn ? { dependsOn: t.dependsOn } : {}), ...(t.prUrl ? { prUrl: t.prUrl } : {}) })),
      (t) => stateOf(detail.tasks.find((r) => r.taskId === t.taskId)!),
    );
    const mine = overview.find((b) => b.taskId === taskId);
    if (mine === undefined) return fail(io, json, `${taskId} has not started, so it has no branch.`);

    if (action === "undo") return undo({ io, json, store, runId, taskId, task, ref, mine, mode: mode!, yes: values.yes === true, now, tools });
    if (action === "pr-draft") return await prDraft({ io, json, task, ref, state: mine.state, tools, deps, model: values.model ?? PR_DRAFT_MODEL });
    const decision = mine.pr;
    if (!decision.ok) return fail(io, json, decision.reason);

    const prs = deps.pullRequests ?? new GhPullRequests();
    try {
      // Before anything is pushed: a pull request that cannot be opened must not leave a pushed branch behind.
      prs.preflight(detail.run.repo);
      tools.push(ref!);
      const { url } = prs.create({ repo: detail.run.repo, head: decision.head, base: decision.base, title: values.title!, body: values.body! });
      store.upsertTask({ runId, taskId, title: task.title, status: task.status, prUrl: url });
      store.recordEvent({ runId, taskId, ts: now(), type: "branch.pr_opened", payload: { url, base: decision.base, head: decision.head } });
      report(io, json, { ok: true, url, base: decision.base, head: decision.head }, [`Opened ${url}`]);
      return 0;
    } catch (err) {
      return fail(io, json, err instanceof Error ? err.message : String(err));
    }
  } finally {
    store.close();
  }
}

interface UndoInput {
  io: CliIo;
  json: boolean;
  store: SqliteRunStore;
  runId: string;
  taskId: string;
  task: TaskRecord;
  ref: BranchRef | undefined;
  mine: BranchOverview;
  mode: UndoMode;
  yes: boolean;
  now: () => string;
  tools: GitBranchTools;
}

function undo(i: UndoInput): number {
  const { io, json, task, mode } = i;
  const decision = i.mine.undo[mode];
  if (!decision.ok) return fail(io, json, decision.reason);
  if (!i.yes) {
    report(io, json, { ok: true, dryRun: true, mode, branch: task.branch, effects: decision.effects }, [...decision.effects, "Nothing was changed. Repeat with --yes to do it."]);
    return 0;
  }
  let sha: string | undefined;
  try {
    if (mode === "revert") sha = i.tools.revert(i.ref!).sha;
    else if (mode === "reset") i.tools.reset(i.ref!);
    else i.tools.remove(i.ref!);
  } catch (err) {
    return fail(io, json, err instanceof Error ? err.message : String(err));
  }
  i.store.recordEvent({ runId: i.runId, taskId: i.taskId, ts: i.now(), type: "branch.undone", payload: { mode, branch: task.branch, ...(sha ? { sha } : {}) } });
  report(io, json, { ok: true, dryRun: false, mode, branch: task.branch, effects: decision.effects, ...(sha ? { sha } : {}) }, [...decision.effects, "Done."]);
  return 0;
}

interface DraftInput {
  io: CliIo;
  json: boolean;
  task: TaskRecord;
  ref: BranchRef | undefined;
  state: BranchState;
  tools: GitBranchTools;
  deps: CliDeps;
  model: string;
}

/** Has the cheap model write a title and a body from the task and its diff. It runs in an empty scratch directory: it only writes text. */
async function prDraft(i: DraftInput): Promise<number> {
  const { io, json, task, state } = i;
  if (!state.exists || i.ref === undefined) return fail(io, json, `The branch of ${task.taskId} no longer exists.`);
  if (state.ahead.length === 0) return fail(io, json, `${task.branch} has no commits after the start, so there is nothing to describe.`);
  const diff = i.tools.diff(i.ref, PR_DRAFT_DIFF_BYTES);
  const prompt = buildPrDraftPrompt({
    taskId: task.taskId,
    title: task.title,
    ...(task.goal ? { goal: task.goal } : {}),
    specs: task.specs ?? [],
    commits: state.ahead,
    stat: diff.stat,
    patch: diff.patch,
    truncated: diff.truncated,
  });
  const options = { model: i.model };
  const agent = i.deps.agent ? i.deps.agent(options) : new CursorAgentRunner(options);
  const scratch = mkdtempSync(join(tmpdir(), "knit-prdraft-"));
  try {
    const result = await agent.run({ cwd: scratch, prompt, timeoutMs: PR_DRAFT_TIMEOUT_MS });
    if (result.isError || result.exitCode !== 0 || result.timedOut) {
      return fail(io, json, `The model could not write the description: ${result.timedOut ? "timed out" : result.resultText || `exit code ${result.exitCode}`}`);
    }
    const draft = parsePrDraft(result.resultText, task.title);
    report(io, json, { ok: true, ...draft, model: i.model }, [`Title: ${draft.title}`, "", draft.body]);
    return 0;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

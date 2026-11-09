import { readFileSync } from "node:fs";
import { isModelId } from "../../core/plan/parse-plan.js";
import { describeBranches } from "../../core/branches/overview.js";
import { isBranchName } from "../../core/branches/pr-rules.js";
import type { UndoMode } from "../../core/ports/branch-tools.js";
import { HttpError, sendJson } from "../http.js";
import type { ControlDeps, RouteModule } from "../types.js";
import { readJsonBody, requireControl, start } from "./control.js";
import { requireSnapshot } from "./runs.js";

const MODES: readonly UndoMode[] = ["revert", "reset", "delete"];
const MAX_TITLE = 200;
const MAX_BODY = 60_000;
/** How long each action may take: an undo is git, a draft waits for a model, a pull request waits for GitHub. */
const DEFAULT_TIMEOUT_MS: Record<string, number> = { undo: 60_000, "pr-draft": 150_000, pr: 120_000 };

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The JSON line a `knit branch --json` child printed last, or undefined when it left none. */
function lastJson(logPath: string): Record<string, unknown> | undefined {
  let text: string;
  try {
    text = readFileSync(logPath, "utf8");
  } catch {
    return undefined;
  }
  for (const line of text.split("\n").reverse()) {
    if (!line.startsWith("{")) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // A line that only looks like JSON: keep looking.
    }
  }
  return undefined;
}

function rejectUnknown(body: Record<string, unknown>, allowed: string[]): void {
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) throw new HttpError(400, `Unknown field: ${unknown.join(", ")}`);
}

/**
 * The branches Cursor created: what each one holds, what undoing it would do and whether it can become a pull request
 * (read through the `BranchInspector` port), and the actions themselves. The actions are `knit branch` children started
 * through the spawner, like abort and resume: the server never touches git or GitHub to change anything. The decisions
 * come from the same pure function the command uses, and the command checks them again before it acts.
 */
export const branchesRoutes: RouteModule = ({ reader, branches, control: controlDeps }) => {
  /** `<run>/<task>` pairs with an action in flight: two at once on one branch could undo and push at the same time. */
  const busy = new Set<string>();

  async function act(control: ControlDeps, res: Parameters<typeof sendJson>[0], runId: string, taskId: string, verb: string, args: string[]): Promise<void> {
    const key = `${runId}/${taskId}`;
    if (busy.has(key)) throw new HttpError(409, `Another action on ${taskId} is still running`);
    busy.add(key);
    let timedOut = false;
    try {
      const { child, logPath } = start(control, `branch-${verb}`, ["branch", runId, taskId, verb, ...args, "--json"]);
      const limit = control.actionTimeoutMs ?? DEFAULT_TIMEOUT_MS[verb] ?? 60_000;
      const outcome = await Promise.race([child.exited.then((code) => ({ code })), sleep(limit).then(() => undefined)]);
      if (outcome === undefined) {
        // The child may still be working on this branch: the task stays locked until it exits, so two actions never overlap.
        timedOut = true;
        void child.exited.finally(() => busy.delete(key));
        sendJson(res, 504, { error: `knit branch ${verb} did not finish in time`, logPath });
        return;
      }
      const answer = lastJson(logPath);
      if (answer === undefined) {
        sendJson(res, 502, { error: `knit branch ${verb} exited (code ${outcome.code}) without an answer`, logPath });
        return;
      }
      if (answer.ok === true) sendJson(res, 200, answer);
      else sendJson(res, 409, { error: typeof answer.reason === "string" ? answer.reason : `knit branch ${verb} did not do it` });
    } finally {
      if (!timedOut) busy.delete(key);
    }
  }

  function requireTask(runId: string, taskId: string): void {
    const snapshot = requireSnapshot(reader, runId);
    const task = snapshot.tasks.find((t) => t.taskId === taskId);
    if (!task) throw new HttpError(404, `Task not found: ${taskId}`);
    if (task.branch === undefined) throw new HttpError(409, `${taskId} has no branch`);
  }

  return [
    {
      method: "GET",
      pattern: "/api/runs/:id/branches",
      handler: ({ res, params }) => {
        const snapshot = requireSnapshot(reader, params.id!);
        if (!branches) throw new HttpError(503, "Branch information is not available on this server");
        const { run, tasks } = snapshot;
        const list = describeBranches(
          { status: run.status, base: run.base },
          tasks.map((t) => ({ taskId: t.taskId, title: t.title, status: t.status, ...(t.branch ? { branch: t.branch } : {}), ...(t.startSha ? { startSha: t.startSha } : {}), ...(t.dependsOn ? { dependsOn: t.dependsOn } : {}), ...(t.prUrl ? { prUrl: t.prUrl } : {}) })),
          (t) => {
            const record = tasks.find((r) => r.taskId === t.taskId)!;
            return branches.state({ repo: run.repo, branch: record.branch!, startSha: record.startSha!, ...(record.worktree ? { worktree: record.worktree } : {}) });
          },
        );
        const at = run.base.lastIndexOf("@");
        sendJson(res, 200, { runId: run.id, runStatus: run.status, base: at === -1 ? run.base : run.base.slice(0, at), branches: list });
      },
    },
    {
      method: "POST",
      pattern: "/api/runs/:id/tasks/:task/undo",
      handler: async ({ req, res, params }) => {
        const control = requireControl(controlDeps);
        const body = await readJsonBody(req);
        rejectUnknown(body, ["mode", "confirm"]);
        if (typeof body.mode !== "string" || !MODES.includes(body.mode as UndoMode)) throw new HttpError(400, `mode must be one of: ${MODES.join(", ")}`);
        if (body.confirm !== true) throw new HttpError(400, "confirm must be true: undoing loses work, so it has to be asked for explicitly");
        requireTask(params.id!, params.task!);
        await act(control, res, params.id!, params.task!, "undo", ["--mode", body.mode, "--yes"]);
      },
    },
    {
      method: "POST",
      pattern: "/api/runs/:id/tasks/:task/pr-draft",
      handler: async ({ req, res, params }) => {
        const control = requireControl(controlDeps);
        const body = await readJsonBody(req);
        rejectUnknown(body, ["model"]);
        if (body.model !== undefined && (typeof body.model !== "string" || !isModelId(body.model))) throw new HttpError(400, "model must be an id from 'agent models': no spaces, and it cannot start with a dash");
        requireTask(params.id!, params.task!);
        await act(control, res, params.id!, params.task!, "pr-draft", body.model === undefined ? [] : ["--model", body.model as string]);
      },
    },
    {
      method: "POST",
      pattern: "/api/runs/:id/tasks/:task/pr",
      handler: async ({ req, res, params }) => {
        const control = requireControl(controlDeps);
        const body = await readJsonBody(req);
        rejectUnknown(body, ["title", "body", "base"]);
        const { title, body: text } = body;
        if (typeof title !== "string" || title.trim() === "" || /[\r\n]/.test(title) || title.length > MAX_TITLE) throw new HttpError(400, `title must be one line of at most ${MAX_TITLE} characters`);
        if (typeof text !== "string" || text.length > MAX_BODY) throw new HttpError(400, `body must be a string of at most ${MAX_BODY} characters`);
        if (body.base !== undefined && (typeof body.base !== "string" || !isBranchName(body.base))) throw new HttpError(400, "base must be a branch name: letters, digits, . _ - and /, not starting with a dash");
        requireTask(params.id!, params.task!);
        // `--name=value`, one argument: a title or body that starts with a dash (a bullet, say) is never read as an option.
        await act(control, res, params.id!, params.task!, "pr", [`--title=${title}`, `--body=${text}`, ...(body.base === undefined ? [] : [`--base=${body.base}`])]);
      },
    },
  ];
};

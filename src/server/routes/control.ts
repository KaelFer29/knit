import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { isModelId, parsePlan, PlanParseError } from "../../core/plan/parse-plan.js";
import type { StoredRun } from "../../core/ports/run-reader.js";
import { HttpError, sendJson } from "../http.js";
import type { ControlDeps, RouteModule, SpawnedProcess } from "../types.js";
import { requireSnapshot } from "./runs.js";

/** Largest JSON body a control route reads. */
export const MAX_BODY_BYTES = 64 * 1024;
/** Largest plan file the start route accepts. */
export const MAX_PLAN_BYTES = 1024 * 1024;
const DEFAULT_REGISTER_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS_LIMIT = 20;

/** Reads a JSON object body. Requires `Content-Type: application/json`; an empty body is `{}`. */
export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") throw new HttpError(415, "Content-Type must be application/json");
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new HttpError(413, `Body is larger than ${MAX_BODY_BYTES} bytes`);

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, `Body is larger than ${MAX_BODY_BYTES} bytes`);
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Body is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new HttpError(400, "Body must be a JSON object");
  return parsed as Record<string, unknown>;
}

interface StartRequest {
  planPath: string;
  push: boolean;
  pr: boolean;
  maxAttempts: number | undefined;
}

function parseStartRequest(body: Record<string, unknown>): StartRequest {
  const unknown = Object.keys(body).filter((k) => !["planPath", "push", "pr", "maxAttempts"].includes(k));
  if (unknown.length > 0) throw new HttpError(400, `Unknown field: ${unknown.join(", ")}`);
  const { planPath, push, pr, maxAttempts } = body;
  if (typeof planPath !== "string" || planPath === "") throw new HttpError(400, "planPath must be a non-empty string");
  if (!isAbsolute(planPath)) throw new HttpError(400, "planPath must be an absolute path");
  if (push !== undefined && typeof push !== "boolean") throw new HttpError(400, "push must be a boolean");
  if (pr !== undefined && typeof pr !== "boolean") throw new HttpError(400, "pr must be a boolean");
  if (maxAttempts !== undefined && (!Number.isInteger(maxAttempts) || (maxAttempts as number) < 1 || (maxAttempts as number) > MAX_ATTEMPTS_LIMIT)) {
    throw new HttpError(400, `maxAttempts must be a whole number from 1 to ${MAX_ATTEMPTS_LIMIT}`);
  }
  return { planPath: resolve(planPath), push: push === true, pr: pr === true, maxAttempts: maxAttempts as number | undefined };
}

/** Checks the plan file and parses it with the core parser. Failures are 400s that list every issue found. */
function validatePlanFile(planPath: string): void {
  if (!/\.md$/i.test(planPath)) throw new HttpError(400, "planPath must be a .md file");
  let size: number;
  try {
    const stat = statSync(planPath);
    if (!stat.isFile()) throw new HttpError(400, "planPath is not a regular file");
    size = stat.size;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, `Cannot read plan: ${(err as NodeJS.ErrnoException).code ?? "error"}`);
  }
  if (size > MAX_PLAN_BYTES) throw new HttpError(400, `Plan is larger than ${MAX_PLAN_BYTES} bytes`);
  let text: string;
  try {
    text = readFileSync(planPath, "utf8");
  } catch (err) {
    throw new HttpError(400, `Cannot read plan: ${(err as NodeJS.ErrnoException).code ?? "error"}`);
  }
  try {
    parsePlan(text);
  } catch (err) {
    if (err instanceof PlanParseError) throw new IssuesError(err.issues);
    throw err;
  }
}

/** A 400 that carries the list of plan issues next to the message. */
class IssuesError extends HttpError {
  constructor(readonly issues: string[]) {
    super(400, `Invalid plan: ${issues.join("; ")}`);
  }
}

/** The longest prompt a follow-up takes from the page. */
const MAX_FOLLOWUP_PROMPT = 20_000;

/** The last lines of a command's log, to say why it refused; empty when there is nothing to read. */
function logTail(logPath: string): string {
  try {
    return readFileSync(logPath, "utf8").trim().split(/\r?\n/).slice(-4).join("\n").slice(-600);
  } catch {
    return "";
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Registration = { kind: "found"; run: StoredRun } | { kind: "exited"; code: number | null } | { kind: "timeout" };

/**
 * Waits until `find` returns the run the child registered. A child that exits first is given one last look (it may have
 * run to completion between two polls) and is otherwise reported as exited.
 */
async function awaitRegistration(
  child: SpawnedProcess,
  find: (childExited: boolean) => StoredRun | undefined,
  pollMs: number,
  timeoutMs: number,
): Promise<Registration> {
  let exit: { code: number | null } | undefined;
  void child.exited.then((code) => {
    exit = { code };
  });
  const end = Date.now() + timeoutMs;
  for (;;) {
    const exited = exit !== undefined;
    const run = safely(() => find(exited));
    if (run) return { kind: "found", run };
    if (exit) return { kind: "exited", code: exit.code };
    if (Date.now() >= end) return { kind: "timeout" };
    await sleep(pollMs);
  }
}

function safely<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function logFileFor(control: ControlDeps, verb: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  return join(control.dataDir, "logs", "_ui", `${verb}-${stamp}-${randomBytes(3).toString("hex")}.log`);
}

export function start(control: ControlDeps, verb: string, args: string[], cwd?: string): { child: SpawnedProcess; logPath: string } {
  const logPath = logFileFor(control, verb);
  let child: SpawnedProcess;
  try {
    child = control.spawn({ args: [...args, "--data-dir", control.dataDir], logFile: logPath, ...(cwd ? { cwd } : {}) });
  } catch (err) {
    throw new HttpError(502, `Could not start knit ${verb}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (child.pid === undefined) throw new HttpError(502, `Could not start knit ${verb}. Log: ${logPath}`);
  return { child, logPath };
}

export function requireControl(control: ControlDeps | undefined): ControlDeps {
  if (!control) throw new HttpError(503, "Run control is not available on this server");
  return control;
}

/** Answers for a child that did not register its run: it died, or it is too slow. */
function failRegistration(res: Parameters<typeof sendJson>[0], verb: string, logPath: string, outcome: Registration): void {
  if (outcome.kind === "exited") {
    sendJson(res, 502, { error: `knit ${verb} exited (code ${outcome.code}) before the run was registered`, logPath });
  } else {
    sendJson(res, 504, { error: `knit ${verb} started but the run did not show up in time`, logPath });
  }
}

/**
 * Run control. Every route is a POST with a JSON body, so it passes the security guard's token and `Origin` checks first;
 * none of them writes the database. They only start Knit commands through the injected spawner.
 */
export const controlRoutes: RouteModule = ({ reader, pollIntervalMs, control: controlDeps }) => {
  const pollMs = Math.min(pollIntervalMs, 100);
  /** Runs being resumed right now: a second request before the first one's process registered would start a second writer. */
  const resuming = new Set<string>();

  /** Spawns `knit resume <id>` for a run that is not running and waits for it to take the run over. */
  /** `<run>/<task>` pairs whose follow-up is starting: a second click must not start a second turn of the same chat. */
  const followingUp = new Set<string>();

  async function resume(control: ControlDeps, runId: string, res: Parameters<typeof sendJson>[0]): Promise<void> {
    if (resuming.has(runId)) throw new HttpError(409, `Run ${runId} is already being resumed`);
    resuming.add(runId);
    try {
      const before = requireSnapshot(reader, runId);
      if (before.run.status === "running") throw new HttpError(409, `Run ${runId} is running`);
      const { child, logPath } = start(control, "resume", ["resume", runId]);
      const outcome = await awaitRegistration(
        child,
        (exited) => {
          const snap = reader.getRunSnapshot(runId);
          if (!snap) return undefined;
          if (snap.run.status === "running" && snap.run.pid === child.pid) return snap.run;
          // A resume that already finished: it recorded `run.resumed` after what we saw before spawning.
          if (exited && reader.getEventsAfter(runId, before.lastEventId).some((e) => e.type === "run.resumed")) return snap.run;
          return undefined;
        },
        pollMs,
        control.registerTimeoutMs ?? DEFAULT_REGISTER_TIMEOUT_MS,
      );
      if (outcome.kind !== "found") return failRegistration(res, "resume", logPath, outcome);
      sendJson(res, 202, { runId, pid: child.pid, logPath });
    } finally {
      resuming.delete(runId);
    }
  }

  return [
    {
      method: "POST",
      pattern: "/api/runs",
      handler: async ({ req, res }) => {
        const control = requireControl(controlDeps);
        const request = parseStartRequest(await readJsonBody(req));
        try {
          validatePlanFile(request.planPath);
        } catch (err) {
          if (err instanceof IssuesError) return sendJson(res, 400, { error: err.message, issues: err.issues });
          throw err;
        }

        const known = new Set(reader.listRuns().map((r) => r.run.id));
        const args = ["run", request.planPath, ...(request.push ? ["--push"] : []), ...(request.pr ? ["--pr"] : [])];
        if (request.maxAttempts !== undefined) args.push("--max-attempts", String(request.maxAttempts));
        const { child, logPath } = start(control, "run", args, dirname(request.planPath));
        const outcome = await awaitRegistration(
          child,
          (exited) =>
            reader
              .listRuns()
              .map((r) => r.run)
              .find((run) => !known.has(run.id) && (exited ? run.planPath === request.planPath : run.status === "running" && run.pid === child.pid)),
          pollMs,
          control.registerTimeoutMs ?? DEFAULT_REGISTER_TIMEOUT_MS,
        );
        if (outcome.kind !== "found") return failRegistration(res, "run", logPath, outcome);
        sendJson(res, 202, { runId: outcome.run.id, pid: child.pid, logPath });
      },
    },
    {
      method: "POST",
      pattern: "/api/runs/:id/abort",
      handler: async ({ req, res, params }) => {
        const control = requireControl(controlDeps);
        await readJsonBody(req);
        const runId = params.id!;
        const snapshot = requireSnapshot(reader, runId);
        if (snapshot.run.status !== "running") throw new HttpError(409, `Run ${runId} is not running`);
        const { logPath } = start(control, "abort", ["abort", runId]);
        sendJson(res, 202, { runId, logPath });
      },
    },
    {
      method: "POST",
      pattern: "/api/runs/:id/resume",
      handler: async ({ req, res, params }) => {
        const control = requireControl(controlDeps);
        await readJsonBody(req);
        await resume(control, params.id!, res);
      },
    },
    {
      method: "POST",
      pattern: "/api/runs/:id/tasks/:task/retry",
      handler: async ({ req, res, params }) => {
        const control = requireControl(controlDeps);
        await readJsonBody(req);
        const snapshot = requireSnapshot(reader, params.id!);
        const task = snapshot.tasks.find((t) => t.taskId === params.task!);
        if (!task) throw new HttpError(404, `Task not found: ${params.task}`);
        if (task.status !== "failed") throw new HttpError(409, `Task ${task.taskId} is ${task.status}, only a failed task can be retried`);
        // Resume already re-runs failed tasks first and the ones that were skipped after them.
        await resume(control, params.id!, res);
      },
    },
    {
      method: "POST",
      pattern: "/api/runs/:id/tasks/:task/followup",
      handler: async ({ req, res, params }) => {
        const control = requireControl(controlDeps);
        const body = await readJsonBody(req);
        const unknown = Object.keys(body).filter((k) => k !== "prompt" && k !== "model");
        if (unknown.length > 0) throw new HttpError(400, `Unknown field: ${unknown.join(", ")}`);
        const { prompt, model } = body;
        if (typeof prompt !== "string" || prompt.trim() === "") throw new HttpError(400, "prompt must be a non-empty string");
        if (prompt.length > MAX_FOLLOWUP_PROMPT) throw new HttpError(400, `prompt is longer than ${MAX_FOLLOWUP_PROMPT} characters`);
        if (model !== undefined && (typeof model !== "string" || !isModelId(model))) throw new HttpError(400, "model must be an id from 'agent models': no spaces, and it cannot start with a dash");
        const runId = params.id!;
        const taskId = params.task!;
        const before = requireSnapshot(reader, runId);
        if (!before.tasks.some((t) => t.taskId === taskId)) throw new HttpError(404, `Task not found: ${taskId}`);
        // Whether the run is still running, whether the task has a chat and whether its worktree can be recreated are decided by
        // `knit followup` itself, which knows how to tell a live process from a crashed one; its reason comes back below.
        const key = `${runId}/${taskId}`;
        if (followingUp.has(key)) throw new HttpError(409, `A follow-up on ${taskId} is already starting`);
        followingUp.add(key);
        try {
          const logPath = logFileFor(control, "followup");
          let child: SpawnedProcess;
          try {
            // `--` before the prompt: one that starts with a dash is a prompt, never an option.
            child = control.spawn({ args: ["followup", runId, taskId, ...(model === undefined ? [] : ["--model", model]), "--data-dir", control.dataDir, "--", prompt], logFile: logPath });
          } catch (err) {
            throw new HttpError(502, `Could not start knit followup: ${err instanceof Error ? err.message : String(err)}`);
          }
          if (child.pid === undefined) throw new HttpError(502, `Could not start knit followup. Log: ${logPath}`);
          const outcome = await awaitRegistration(
            child,
            () => {
              const snap = reader.getRunSnapshot(runId);
              if (!snap) return undefined;
              return reader.getEventsAfter(runId, before.lastEventId).some((e) => e.type === "followup.started" && e.taskId === taskId) ? snap.run : undefined;
            },
            pollMs,
            control.registerTimeoutMs ?? DEFAULT_REGISTER_TIMEOUT_MS,
          );
          if (outcome.kind === "found") return sendJson(res, 202, { runId, taskId, pid: child.pid, logPath });
          const reason = outcome.kind === "exited" ? logTail(logPath) : "";
          if (reason !== "") return sendJson(res, 409, { error: reason, logPath });
          return failRegistration(res, "followup", logPath, outcome);
        } finally {
          followingUp.delete(key);
        }
      },
    },
  ];
};

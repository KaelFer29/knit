import { existsSync } from "node:fs";
import { join } from "node:path";
import { CursorAgentRunner } from "../../adapters/agents/cursor/cursor-runner.js";
import { ShellCheckRunner } from "../../adapters/checks/shell/shell-check-runner.js";
import { SqliteRunStore, type RunDetail } from "../../adapters/storage/sqlite/run-store.js";
import { SqliteSessionStore } from "../../adapters/storage/sqlite/session-store.js";
import { killActiveProcessGroups } from "../../adapters/system/spawn-with-timeout.js";
import { GitWorkspace } from "../../adapters/vcs/git/git-workspace.js";
import { parsePlan, PlanParseError, type Task } from "../../core/plan/parse-plan.js";
import type { AgentProfile, AgentRunner } from "../../core/ports/agent-runner.js";
import type { EventRecord, TaskRecord } from "../../core/ports/run-store.js";
import type { SessionRecord, TurnRecord } from "../../core/ports/session-store.js";
import { FollowupError, checkFollowupAgent, runFollowup } from "../../core/run/run-followup.js";
import { UsageError } from "../errors.js";
import { parse } from "../support/args.js";
import { formatProgress, formatSessionEvent } from "../support/format.js";
import { DB_FILENAME, dataDirOf, makeSessionId, openStoreIfExists } from "../support/paths.js";
import type { CliDeps, CliIo } from "../types.js";
import { PROGRAM_NAME } from "../usage.js";

/** Same limits as an attempt of the run loop. */
const AGENT_TIMEOUT_MS = 10 * 60_000;
const CHECK_TIMEOUT_MS = 5 * 60_000;

const OPTIONS = {
  model: { type: "string" },
  "agent-command": { type: "string" },
  "data-dir": { type: "string" },
} as const;

/** Whether a process exists. `EPERM` means it exists but belongs to someone else. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The chat to continue: the agent session id of the task's latest attempt that recorded one. */
function chatIdOf(detail: RunDetail, taskId: string): string | undefined {
  return detail.attempts.filter((a) => a.taskId === taskId && a.attempt > 0 && a.sessionId !== undefined).at(-1)?.sessionId;
}

/** Everything that decides whether a follow-up may start; the first problem found is returned as a message. */
function refusalOf(detail: RunDetail, task: TaskRecord): string | undefined {
  const { run } = detail;
  if (run.pid !== undefined && isProcessAlive(run.pid)) {
    return `Run ${run.id} is still running (process ${run.pid}). Wait for it to finish, or stop it, before sending a follow-up.`;
  }
  if (run.planText === undefined) {
    return `Run ${run.id} predates plan snapshots, so Knit has no plan to verify the follow-up against. Start a new run.`;
  }
  if (!task.worktree || !existsSync(join(task.worktree, ".git"))) {
    return `The worktree of ${task.taskId} is not on disk${task.worktree ? ` (${task.worktree})` : ""}, so there is nowhere to continue its chat.`;
  }
  if (chatIdOf(detail, task.taskId) === undefined) {
    return `Task ${task.taskId} has no recorded attempt with an agent session id, so there is no chat to resume.`;
  }
  return undefined;
}

function planTaskOf(planText: string, taskId: string): Task | string {
  try {
    const task = parsePlan(planText).tasks.find((t) => t.id === taskId);
    return task ?? `Task ${taskId} is not in the plan snapshot of the run.`;
  } catch (err) {
    if (err instanceof PlanParseError) return `The plan snapshot of the run cannot be read: ${err.message}`;
    throw err;
  }
}

/** The session that holds the task's chat: reused when it exists, so every follow-up lands in the same conversation. */
function sessionFor(store: SqliteSessionStore, detail: RunDetail, task: TaskRecord, chatId: string, now: Date): SessionRecord {
  const existing = store.listSessions().find((s) => s.agent === "cursor" && s.cwd === task.worktree && s.agentSessionId === chatId);
  if (existing) return existing;
  const id = makeSessionId(now);
  store.createSession({
    id,
    agent: "cursor",
    title: `${detail.run.id} ${task.taskId}: ${task.title}`,
    cwd: task.worktree!,
    createdAt: now.toISOString(),
  });
  store.setAgentSessionId(id, chatId, now.toISOString());
  return store.getSession(id)!;
}

/** True when the session's latest turn is still in flight in a live process. */
function turnInFlight(store: SqliteSessionStore, session: SessionRecord): boolean {
  if (session.status !== "running") return false;
  const last = store.listTurns(session.id).at(-1);
  return last?.status === "running" && last.pid !== undefined && isProcessAlive(last.pid);
}

/**
 * Sends a follow-up prompt to the Cursor chat of one task and verifies the result again. The agent continues its
 * conversation inside the task's own worktree; Knit then runs the same verification as for an attempt of the run
 * loop and records the outcome as the task's next attempt. Exit code 0 when it passed, 1 when it failed or was refused.
 */
export async function followupCommand(args: string[], io: CliIo, deps: CliDeps, env: NodeJS.ProcessEnv): Promise<number> {
  const { values, positionals } = parse(args, OPTIONS);
  if (positionals.length !== 3) throw new UsageError('followup needs exactly three arguments: <run-id> <task-id> "<prompt>"');
  const [runId, taskId, prompt] = positionals as [string, string, string];
  if (prompt.trim() === "") throw new UsageError("followup needs a prompt: the third argument is empty");

  const runs = openStoreIfExists(env, values["data-dir"]);
  const detail = runs?.getRun(runId);
  runs?.close();
  if (!detail) {
    io.err(`Run not found: ${runId}\n`);
    return 1;
  }
  const task = detail.tasks.find((t) => t.taskId === taskId);
  if (!task) {
    io.err(`Task not found: ${taskId} (run ${runId} has ${detail.tasks.map((t) => t.taskId).join(", ") || "no tasks"})\n`);
    return 1;
  }
  const refusal = refusalOf(detail, task);
  if (refusal) {
    io.err(`${refusal}\n`);
    return 1;
  }
  const planTask = planTaskOf(detail.run.planText!, taskId);
  if (typeof planTask === "string") {
    io.err(`${planTask}\n`);
    return 1;
  }
  const chatId = chatIdOf(detail, taskId)!;

  const agentOptions = {
    agent: "cursor",
    ...(values["agent-command"] ? { command: values["agent-command"] } : {}),
    ...(values.model ? { model: values.model } : {}),
  };
  const agent: AgentRunner = deps.agent ? deps.agent(agentOptions) : new CursorAgentRunner(agentOptions);
  try {
    checkFollowupAgent(agent);
  } catch (err) {
    io.err(`${(err as Error).message}\n`);
    return 1;
  }

  const dataDir = dataDirOf(values, env);
  const dbPath = join(dataDir, DB_FILENAME);
  const runStore = new SqliteRunStore(dbPath);
  const sessionStore = new SqliteSessionStore(dbPath);
  const now = deps.now ?? (() => new Date());
  const workspace = new GitWorkspace({ root: join(dataDir, "worktrees"), ...(deps.gitArgs ? { gitArgs: deps.gitArgs } : {}) });
  const profile: AgentProfile = values.model ? { model: values.model } : {};

  let turn: TurnRecord | undefined;
  let attempt: number | undefined;
  let signalled = false;
  const onSignal = (): void => {
    if (signalled) return;
    signalled = true;
    killActiveProcessGroups("SIGKILL");
    try {
      const ts = now().toISOString();
      if (turn) sessionStore.finishTurn(turn.id, { status: "failed", finishedAt: ts, resultText: "Aborted" });
      if (attempt !== undefined) {
        const ctx = { runId, taskId, attempt, ts };
        runStore.recordEvent({ ...ctx, type: "attempt.finished", payload: { passed: false, scopeOk: true } } satisfies EventRecord);
        runStore.recordEvent({ ...ctx, type: "followup.finished", payload: { passed: false, reason: "Aborted" } });
        runStore.upsertTask({ runId, taskId, title: task.title, status: "failed" });
      }
    } catch {
      /* best effort */
    }
    io.err(`\nAborted. Turn and task ${taskId} marked as failed.\n`);
    process.exit(130);
  };

  try {
    const session = sessionFor(sessionStore, detail, task, chatId, now());
    if (turnInFlight(sessionStore, session)) {
      io.err(`Another turn of this chat (session ${session.id}) is still running. Wait for it to finish.\n`);
      return 1;
    }

    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    const summary = await runFollowup(
      {
        agent,
        checks: new ShellCheckRunner(),
        workspace,
        runs: runStore,
        sessions: sessionStore,
        now,
        onProgress: (e) => {
          const line = formatProgress(e);
          if (line) io.out(`${line}\n`);
        },
        onAgentEvent: (e) => io.out(`${formatSessionEvent(e)}\n`),
      },
      {
        runId,
        task,
        planTask,
        sessionId: session.id,
        prompt,
        ...(Object.keys(profile).length > 0 ? { profile } : {}),
        pid: process.pid,
        agentTimeoutMs: AGENT_TIMEOUT_MS,
        checkTimeoutMs: CHECK_TIMEOUT_MS,
        onTurnStart: (t, a) => {
          turn = t;
          attempt = a;
        },
      },
    );

    if (summary.passed) {
      io.out(`\n${summary.resultText}\n`);
      io.out(`\nKnit verification: passed (attempt ${summary.attempt}, commit ${summary.commitSha?.slice(0, 8)})\n`);
      if (detail.run.status === "failed") {
        io.out(`The run is still marked failed; ${PROGRAM_NAME} resume ${runId} keeps ${taskId} as passed and continues with the next task.\n`);
      }
    } else {
      io.err(`\nKnit verification: failed (attempt ${summary.attempt}): ${summary.reason}\n`);
      io.err(`Send another follow-up to fix it: ${PROGRAM_NAME} followup ${runId} ${taskId} "<prompt>"\n`);
    }
    io.out(`\nSession: ${session.id}\n`);
    io.out(`Continue in a terminal: cd ${task.worktree} && agent --resume ${chatId}\n`);
    io.out(`Details: ${PROGRAM_NAME} show ${runId}\n`);
    return summary.passed ? 0 : 1;
  } catch (err) {
    if (err instanceof FollowupError) {
      io.err(`${err.message}\n`);
      return 1;
    }
    throw err;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    sessionStore.close();
    runStore.close();
  }
}

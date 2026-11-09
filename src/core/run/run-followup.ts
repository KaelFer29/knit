import { contextShare, contextWindowOf, shouldSwitchChat } from "../context/index.js";
import { runTurn } from "../chat/run-turn.js";
import { renderFollowupPrompt } from "../prompt/render-prompt.js";
import type { Task } from "../plan/parse-plan.js";
import { capabilitiesOf, type AgentProfile, type AgentRunner } from "../ports/agent-runner.js";
import type { CheckRunner } from "../ports/check-runner.js";
import type { EventRecord, RunStore, TaskRecord } from "../ports/run-store.js";
import type { SessionEventRecord, SessionStore, TurnRecord } from "../ports/session-store.js";
import type { Workspace } from "../ports/workspace.js";
import { RESULT_TEXT_LIMIT, describeFailure, truncate, verifyAttempt } from "./verify-attempt.js";

/** A problem with the request itself (no worktree, an agent that cannot resume), found before anything was changed. */
export class FollowupError extends Error {}

export interface FollowupDeps {
  /** The agent that owns the task's chat. */
  agent: AgentRunner;
  checks: CheckRunner;
  workspace: Workspace;
  runs: RunStore;
  sessions: SessionStore;
  now: () => Date;
  /** Same lifecycle events that are stored. */
  onProgress?: (event: EventRecord) => void;
  /** Each timeline entry of the turn, right after it is stored. */
  onAgentEvent?: (event: SessionEventRecord) => void;
}

/** How much of the instruction is kept with the event, so a pull request can say what the follow-up fixed. */
const MAX_RECORDED_PROMPT = 4000;

export interface FollowupInput {
  runId: string;
  /** The task as recorded by the run: its worktree, branch and start commit. */
  task: TaskRecord;
  /** The task as the run's plan snapshot defines it: its allowed files and checks. */
  planTask: Task;
  /** Knit session that holds the task's chat; its agent session id is the chat to resume. */
  sessionId: string;
  prompt: string;
  profile?: AgentProfile;
  /** Process executing the follow-up, stored on the turn until it ends. */
  pid?: number;
  agentTimeoutMs: number;
  checkTimeoutMs: number;
  /** Called once the turn is recorded and before the agent starts. */
  onTurnStart?: (turn: TurnRecord, attempt: number) => void;
}

export interface FollowupSummary {
  /** Number of the attempt row this follow-up recorded. */
  attempt: number;
  /** Knit's verdict: the process ended cleanly, scope and git are fine and every check passed. */
  passed: boolean;
  /** Why it failed, in one line. */
  reason?: string;
  /** Last commit of the task branch, when it passed. */
  commitSha?: string;
  resultText: string;
  /** How full the chat is after the turn, when the agent reported it. `full`: it has passed the share at which a chat is replaced. */
  context?: { tokens: number; window: number; share: number; full: boolean };
}

/** A follow-up continues the agent's chat, so an agent that cannot resume one cannot take it. */
export function checkFollowupAgent(agent: AgentRunner): void {
  if (!capabilitiesOf(agent).resume) {
    throw new FollowupError(`${agent.name ?? "The agent"} cannot resume a chat here, so it cannot take a follow-up. Run the task again instead.`);
  }
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * A follow-up prompt on a task's agent chat. The agent resumes its conversation inside the task's own worktree
 * (so it still has the task's context), the turn is recorded in the session, and Knit verifies the result again
 * exactly as it does for an attempt of the run loop (`verifyAttempt`). The outcome is the task's next attempt: its
 * row, its timeline, the task's status and last commit, and the lifecycle events a live view follows.
 * Deterministic apart from the agent: no model is called by Knit.
 */
export async function runFollowup(deps: FollowupDeps, input: FollowupInput): Promise<FollowupSummary> {
  const { agent, checks, workspace, runs, sessions, now } = deps;
  const { runId, task, planTask } = input;

  // Everything that can be rejected up front is checked before any state is changed.
  checkFollowupAgent(agent);
  const session = sessions.getSession(input.sessionId);
  if (!session) throw new FollowupError(`Session not found: ${input.sessionId}`);
  if (session.agentSessionId === undefined) throw new FollowupError(`Session ${session.id} has no ${session.agent} chat to resume`);
  if (!task.worktree || !task.branch || !task.startSha) throw new FollowupError(`Task ${task.taskId} has no worktree recorded`);
  const ws = workspace.attach({ path: task.worktree, branch: task.branch, startSha: task.startSha });
  if (!ws) throw new FollowupError(`The worktree of ${task.taskId} no longer exists: ${task.worktree}`);

  const attempt = runs.nextAttempt(runId, task.taskId);
  const ctx = { taskId: task.taskId, attempt };
  const emit = (type: string, payload?: unknown): void => {
    const event: EventRecord = {
      runId,
      ts: now().toISOString(),
      type,
      taskId: ctx.taskId,
      attempt: ctx.attempt,
      ...(payload !== undefined ? { payload } : {}),
    };
    runs.recordEvent(event);
    deps.onProgress?.(event);
  };
  const startedAt = now().toISOString();
  const started = now().getTime();

  runs.upsertTask({ runId, taskId: task.taskId, title: task.title, status: "running" });
  emit("followup.started", { sessionId: session.id, chatId: session.agentSessionId, prompt: input.prompt.slice(0, MAX_RECORDED_PROMPT) });
  // A follow-up always continues the chat of the task, so it always resumes.
  emit("attempt.started", { chat: "resumed" });

  const finish = (summary: FollowupSummary): FollowupSummary => {
    emit("followup.finished", {
      passed: summary.passed,
      ...(summary.commitSha !== undefined ? { commitSha: summary.commitSha } : {}),
      ...(summary.reason !== undefined ? { reason: summary.reason } : {}),
    });
    return summary;
  };

  try {
    const { result } = await runTurn(
      { agent, store: sessions, now },
      {
        sessionId: session.id,
        prompt: renderFollowupPrompt(input.prompt, task.branch),
        timeoutMs: input.agentTimeoutMs,
        ...(input.profile ? { profile: input.profile } : {}),
        ...(input.pid !== undefined ? { pid: input.pid } : {}),
        ...(input.onTurnStart ? { onTurnStart: (turn: TurnRecord) => input.onTurnStart!(turn, attempt) } : {}),
        onEvent: (e) => {
          // The same entry goes to the task's attempt, so a run's view shows the follow-up like any other attempt.
          runs.recordAgentEvent({ runId, taskId: task.taskId, attempt, ts: e.ts, kind: e.kind, payload: e.payload, agent: e.agent });
          deps.onAgentEvent?.(e);
        },
      },
    );

    const verdict = await verifyAttempt(
      { checks, workspace },
      { task: planTask, ws, result, checkTimeoutMs: input.checkTimeoutMs, onCheckStarted: (command) => emit("check.started", { command }) },
    );
    const { passed, violations, gitProblems, failedCheck } = verdict;

    runs.recordAttempt({
      runId, taskId: task.taskId, attempt, startedAt, durationMs: result.durationMs, exitCode: result.exitCode,
      isError: result.isError, scopeOk: violations.length === 0, status: passed ? "passed" : "failed",
      resultText: truncate(result.resultText, RESULT_TEXT_LIMIT),
      ...(result.inputTokens !== undefined ? { inputTokens: result.inputTokens } : {}),
      ...(result.outputTokens !== undefined ? { outputTokens: result.outputTokens } : {}),
      sessionId: result.sessionId ?? session.agentSessionId,
      ...(failedCheck !== undefined ? { failedCheck } : {}),
    });
    emit("attempt.finished", {
      passed, scopeOk: violations.length === 0, failedCheck,
      ...(result.contextTokens !== undefined ? { contextTokens: result.contextTokens } : {}),
      ...(gitProblems.length > 0 ? { gitProblems } : {}),
    });

    if (passed) {
      const commitSha = verdict.inspection.commits.at(-1)?.sha ?? ws.startSha;
      runs.upsertTask({ runId, taskId: task.taskId, title: task.title, status: "passed", commitSha });
      emit("task.passed", { commitSha, attempts: attempt });
      return finish({ attempt, passed: true, commitSha, resultText: result.resultText, ...contextSummary(result.contextTokens, planTask.model) });
    }
    const reason = describeFailure(verdict.problems);
    runs.upsertTask({ runId, taskId: task.taskId, title: task.title, status: "failed" });
    emit("task.failed", { reason, attempts: attempt });
    return finish({ attempt, passed: false, reason, resultText: result.resultText, ...contextSummary(result.contextTokens, planTask.model) });
  } catch (err) {
    // The turn is already closed by `runTurn`; close the attempt too so nothing stays open on the board.
    const reason = `Unexpected error: ${errorMessage(err)}`;
    runs.recordAttempt({
      runId, taskId: task.taskId, attempt, startedAt, durationMs: now().getTime() - started, exitCode: null,
      isError: true, scopeOk: true, status: "failed", resultText: truncate(reason, RESULT_TEXT_LIMIT),
      ...(session.agentSessionId !== undefined ? { sessionId: session.agentSessionId } : {}),
    });
    emit("attempt.finished", { passed: false, scopeOk: true });
    runs.upsertTask({ runId, taskId: task.taskId, title: task.title, status: "failed" });
    emit("task.failed", { reason, attempts: attempt });
    return finish({ attempt, passed: false, reason, resultText: reason });
  }
}

/** How full the chat is after a turn, from what the agent reported and the window of the task's model. */
function contextSummary(tokens: number | undefined, model: string | undefined): { context?: NonNullable<FollowupSummary["context"]> } {
  if (tokens === undefined) return {};
  const window = contextWindowOf(model);
  return { context: { tokens, window, share: contextShare(tokens, window), full: shouldSwitchChat(tokens, window) } };
}


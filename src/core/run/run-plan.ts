import { AgentEventNormalizer, type AgentLogEntry } from "../timeline/normalize-agent-events.js";
import type { ResolvedPlan, Task } from "../plan/parse-plan.js";
import { contextWindowOf, shouldSwitchChat } from "../context/index.js";
import { capabilitiesOf, type AgentRunResult, type AgentRunner } from "../ports/agent-runner.js";
import type { CheckRunner } from "../ports/check-runner.js";
import type { PullRequests } from "../ports/pull-requests.js";
import type { EventRecord, RunStore, TaskRecord } from "../ports/run-store.js";
import type { TranscriptStore } from "../ports/transcript.js";
import type { TaskWorkspace, Workspace } from "../ports/workspace.js";
import { renderContinuationPrompt, renderPrompt, type RetryContext } from "../prompt/render-prompt.js";
import { prBody, prTitle } from "./pull-request-text.js";
import { RESULT_TEXT_LIMIT, describeFailure, truncate, verifyAttempt } from "./verify-attempt.js";

export interface RunDeps {
  agent: AgentRunner;
  checks: CheckRunner;
  workspace: Workspace;
  store: RunStore;
  /** Required when `options.pr` is set. */
  pullRequests?: PullRequests;
  /** Keeps the raw agent stream of every attempt (optional). */
  transcripts?: TranscriptStore;
  now?: () => Date;
  /** Live progress hook (same events that are stored). */
  onProgress?: (event: EventRecord) => void;
}

export interface RunOptions {
  runId: string;
  planPath: string;
  /** Plan file content, stored with the run when it starts. */
  planText?: string;
  /** Process executing the run, recorded so it can be found and stopped. */
  pid?: number;
  /** Attempts per task before it is failed (default 2). */
  maxAttempts?: number;
  agentTimeoutMs?: number;
  checkTimeoutMs?: number;
  /** Push each passed task's branch to origin. */
  push?: boolean;
  /** Open a PR per passed task (implies push). Stacked tasks target their parent's branch. */
  pr?: boolean;
  /** Continue an existing run: passed tasks are reused, the rest are (re)run. */
  resume?: boolean;
}

export interface TaskOutcome {
  taskId: string;
  status: "passed" | "failed" | "skipped";
  attempts: number;
  commitSha?: string;
  prUrl?: string;
  reason?: string;
  /** The task had already passed in an earlier run and was not executed again. */
  reused?: true;
}

export interface RunSummary {
  runId: string;
  status: "passed" | "failed";
  tasks: TaskOutcome[];
  /** Delivery problems (push, pull request) that did not fail the run. */
  warnings: string[];
}

const DEFAULTS = { maxAttempts: 2, agentTimeoutMs: 10 * 60_000, checkTimeoutMs: 5 * 60_000 };
const RESUME_NOTE =
  "A previous run of this task did not finish. Check the current state of the branch, finish the work, and leave everything committed.";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The run loop. For each task: prepare a worktree on the task's branch, run the agent
 * (which edits and commits), verify (process, scope, git hygiene, checks), retry with feedback,
 * then optionally push and open a PR. Deterministic code: all intelligence lives behind the ports.
 */
/** What the plan says about a task, stored with it so a run can be shown without re-reading the plan file. */
function snapshotOf(task: Task, index: number): Pick<TaskRecord, "goal" | "dependsOn" | "position" | "specs"> {
  return {
    goal: task.goal,
    ...(task.dependsOn ? { dependsOn: task.dependsOn } : {}),
    position: index + 1,
    specs: task.specs.map((s) => ({ id: s.id, text: s.text })),
  };
}

export async function runPlan(plan: ResolvedPlan, deps: RunDeps, options: RunOptions): Promise<RunSummary> {
  const { agent, checks, workspace, store } = deps;
  const maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts;
  const agentTimeoutMs = options.agentTimeoutMs ?? DEFAULTS.agentTimeoutMs;
  const checkTimeoutMs = options.checkTimeoutMs ?? DEFAULTS.checkTimeoutMs;
  const now = deps.now ?? (() => new Date());
  const runId = options.runId;
  const wantPr = options.pr === true;
  const wantPush = wantPr || options.push === true;
  const warnings: string[] = [];

  const emit = (type: string, ctx: { taskId?: string; attempt?: number } = {}, payload?: unknown): void => {
    const event: EventRecord = {
      runId,
      ts: now().toISOString(),
      type,
      ...(ctx.taskId !== undefined ? { taskId: ctx.taskId } : {}),
      ...(ctx.attempt !== undefined ? { attempt: ctx.attempt } : {}),
      ...(payload !== undefined ? { payload } : {}),
    };
    store.recordEvent(event);
    deps.onProgress?.(event);
  };

  // Everything that can be rejected up front is checked before any state is created.
  const baseRef = workspace.resolveBase(plan.repo, plan.base);
  if (wantPr) {
    if (!deps.pullRequests) throw new Error("Cannot open pull requests: no pull request adapter configured");
    if (!baseRef.branch) {
      throw new Error("Cannot open pull requests: the base is not a local branch. Set 'Base: <branch>' in the plan.");
    }
    deps.pullRequests.preflight(plan.repo);
  }

  const existing = new Map<string, TaskRecord>();
  if (options.resume) {
    for (const t of store.getTasks(runId)) existing.set(t.taskId, t);
    store.reopenRun(runId, options.pid);
    plan.tasks.forEach((t, i) => {
      if (!existing.has(t.id)) store.upsertTask({ runId, taskId: t.id, title: t.title, status: "pending", ...snapshotOf(t, i) });
    });
    emit("run.resumed", {}, { tasks: plan.tasks.length, repo: plan.repo });
  } else {
    store.createRun({
      id: runId,
      planName: plan.name,
      planPath: options.planPath,
      repo: plan.repo,
      base: `${plan.base ?? baseRef.branch ?? "HEAD"}@${baseRef.sha.slice(0, 8)}`,
      startedAt: now().toISOString(),
      ...(options.planText !== undefined ? { planText: options.planText } : {}),
      ...(options.pid !== undefined ? { pid: options.pid } : {}),
    });
    plan.tasks.forEach((t, i) => {
      store.upsertTask({ runId, taskId: t.id, title: t.title, status: "pending", ...snapshotOf(t, i) });
    });
    emit("run.started", {}, { tasks: plan.tasks.length, repo: plan.repo });
  }

  const branchOf = new Map<string, string>();
  const outcomes: TaskOutcome[] = [];
  let failed = false;

  for (const task of plan.tasks) {
    if (failed) {
      outcomes.push({ taskId: task.id, status: "skipped", attempts: 0 });
      continue;
    }
    const prev = existing.get(task.id);
    if (prev?.status === "passed" && prev.branch) {
      branchOf.set(task.id, prev.branch);
      outcomes.push(await reuse(task, prev));
      continue;
    }
    const outcome = await runTask(task, prev);
    outcomes.push(outcome);
    if (outcome.status === "passed") branchOf.set(task.id, task.branch);
    else failed = true;
  }

  const status = failed ? "failed" : "passed";
  store.finishRun(runId, status, now().toISOString());
  emit("run.finished", {}, { status, warnings: warnings.length });
  return { runId, status, tasks: outcomes, warnings };

  function startPointOf(task: Task): string {
    return task.dependsOn ? (branchOf.get(task.dependsOn) ?? baseRef.sha) : baseRef.sha;
  }

  /** Push and open the PR for a passed task. Failures are warnings: the work itself passed. */
  function deliver(task: Task, ws: TaskWorkspace, knownPrUrl?: string): string | undefined {
    if (!wantPush) return undefined;
    if (wantPr && knownPrUrl) return knownPrUrl;
    const ctx = { taskId: task.id };
    try {
      workspace.push(ws);
      emit("push.finished", ctx, { branch: ws.branch });
    } catch (err) {
      warnings.push(`${task.id}: push failed: ${errorMessage(err)}`);
      emit("push.failed", ctx, { error: errorMessage(err) });
      return undefined;
    }
    if (!wantPr) return undefined;
    const base = task.dependsOn ? branchOf.get(task.dependsOn) : baseRef.branch;
    try {
      const { url } = deps.pullRequests!.create({
        repo: plan.repo,
        head: ws.branch,
        base: base!,
        title: prTitle(task),
        body: prBody(task, runId),
      });
      store.upsertTask({ runId, taskId: task.id, title: task.title, status: "passed", prUrl: url });
      emit("pr.created", ctx, { url, base });
      return url;
    } catch (err) {
      warnings.push(`${task.id}: pull request failed: ${errorMessage(err)}`);
      emit("pr.failed", ctx, { error: errorMessage(err) });
      return undefined;
    }
  }

  async function reuse(task: Task, prev: TaskRecord): Promise<TaskOutcome> {
    emit("task.reused", { taskId: task.id }, { branch: prev.branch });
    let prUrl = prev.prUrl;
    if (wantPush && !(wantPr && prev.prUrl)) {
      const ws =
        prev.worktree && prev.startSha
          ? workspace.attach({ path: prev.worktree, branch: prev.branch!, startSha: prev.startSha })
          : undefined;
      if (ws) prUrl = deliver(task, ws, prev.prUrl) ?? prUrl;
      else warnings.push(`${task.id}: cannot deliver: its worktree no longer exists`);
    }
    return {
      taskId: task.id,
      status: "passed",
      attempts: 0,
      ...(prev.commitSha ? { commitSha: prev.commitSha } : {}),
      ...(prUrl ? { prUrl } : {}),
      reused: true,
    };
  }

  async function runTask(task: Task, prev?: TaskRecord): Promise<TaskOutcome> {
    const ctx = { taskId: task.id };
    let ws: TaskWorkspace | undefined;
    let resumed = false;
    try {
      if (prev?.worktree && prev.startSha && prev.branch) {
        ws = workspace.attach({ path: prev.worktree, branch: prev.branch, startSha: prev.startSha });
        resumed = ws !== undefined;
      }
      ws ??= workspace.prepare({
        repo: plan.repo,
        runId,
        taskId: task.id,
        branch: task.branch,
        startPoint: startPointOf(task),
      });
    } catch (err) {
      return failTask(task, 0, `Unexpected error: ${errorMessage(err)}`);
    }
    store.upsertTask({
      runId, taskId: task.id, title: task.title, status: "running",
      branch: ws.branch, worktree: ws.path, startSha: ws.startSha,
    });
    emit("task.started", ctx, { branch: ws.branch, worktree: ws.path, startPoint: startPointOf(task), resumed });

    try {
      if (!resumed) {
        for (const command of plan.setup) {
          emit("setup.started", ctx, { command });
          const r = await checks.run(command, ws.path, checkTimeoutMs);
          if (r.exitCode !== 0 || r.timedOut) {
            store.recordAttempt({
              runId, taskId: task.id, attempt: 0, startedAt: now().toISOString(), durationMs: r.durationMs,
              exitCode: r.exitCode, isError: true, scopeOk: true, failedCheck: command, status: "failed",
              resultText: truncate(r.output, RESULT_TEXT_LIMIT),
            });
            return failTask(task, 0, `Setup failed: ${command}`, ws.branch);
          }
        }
      }

      let retry: RetryContext | undefined = resumed ? { processFailure: RESUME_NOTE } : undefined;
      let lastReason = "";
      const firstAttempt = store.nextAttempt(runId, task.id);
      // The chat of the last attempt of this task, when it ended cleanly and the agent can resume it. A task always starts in a fresh chat.
      let chat: { id: string; contextTokens: number | undefined } | undefined;
      const canResume = capabilitiesOf(agent).resume;
      const window = contextWindowOf(task.model);
      for (let i = 0; i < maxAttempts; i++) {
        const attempt = firstAttempt + i;
        const actx = { taskId: task.id, attempt };
        const startedAt = now().toISOString();
        // A retry continues the chat while it has room; once it reaches the threshold (or its size is unknown) a fresh chat gets the whole task again.
        const previous = canResume && retry !== undefined ? chat : undefined;
        const mode: "new" | "resumed" | "switched" =
          previous === undefined || previous.contextTokens === undefined ? "new" : shouldSwitchChat(previous.contextTokens, window) ? "switched" : "resumed";
        emit("attempt.started", actx, { chat: mode, ...(previous?.contextTokens !== undefined ? { contextTokens: previous.contextTokens } : {}) });

        const transcript = deps.transcripts?.open({ runId, taskId: task.id, attempt });
        const normalizer = new AgentEventNormalizer();
        const record = (entries: AgentLogEntry[]): void => {
          for (const entry of entries) {
            store.recordAgentEvent({
              runId, taskId: task.id, attempt, ts: now().toISOString(), kind: entry.kind, payload: entry.payload,
              ...(agent.name ? { agent: agent.name } : {}),
            });
          }
        };
        let result: AgentRunResult;
        try {
          result = await agent.run(
            {
              cwd: ws.path,
              prompt: mode === "resumed" ? renderContinuationPrompt(retry!) : renderPrompt(task, retry),
              timeoutMs: agentTimeoutMs,
              ...(task.model ? { profile: { model: task.model } } : {}),
              ...(mode === "resumed" ? { resumeSessionId: previous!.id } : {}),
            },
            (e) => {
              transcript?.append(e);
              record(normalizer.push(e.raw));
              if (e.type !== "tool_call") return;
              const raw = e.raw as { subtype?: string; call_id?: string; tool_call?: Record<string, unknown> };
              emit("agent.tool_call", actx, {
                subtype: raw.subtype,
                callId: raw.call_id,
                tool: raw.tool_call ? Object.keys(raw.tool_call)[0] : undefined,
              });
            },
          );
        } finally {
          record(normalizer.flush());
          transcript?.close();
        }

        chat = result.sessionId !== undefined && !result.isError && !result.timedOut ? { id: result.sessionId, contextTokens: result.contextTokens } : undefined;

        const verdict = await verifyAttempt(
          { checks, workspace },
          {
            task,
            ws,
            result,
            checkTimeoutMs,
            onCheckStarted: (command) => emit("check.started", actx, { command }),
          },
        );
        const { problems: next, violations, gitProblems, failedCheck, inspection, passed } = verdict;

        store.recordAttempt({
          runId, taskId: task.id, attempt, startedAt, durationMs: result.durationMs, exitCode: result.exitCode,
          isError: result.isError, scopeOk: violations.length === 0, status: passed ? "passed" : "failed",
          resultText: truncate(result.resultText, RESULT_TEXT_LIMIT),
          ...(result.inputTokens !== undefined ? { inputTokens: result.inputTokens } : {}),
          ...(result.outputTokens !== undefined ? { outputTokens: result.outputTokens } : {}),
          ...(result.sessionId !== undefined ? { sessionId: result.sessionId } : {}),
          ...(failedCheck !== undefined ? { failedCheck } : {}),
        });
        emit("attempt.finished", actx, {
          passed, scopeOk: violations.length === 0, failedCheck,
          ...(result.contextTokens !== undefined ? { contextTokens: result.contextTokens } : {}),
          ...(gitProblems.length > 0 ? { gitProblems } : {}),
        });

        if (passed) {
          const sha = inspection.commits.at(-1)?.sha ?? ws.startSha;
          store.upsertTask({ runId, taskId: task.id, title: task.title, status: "passed", commitSha: sha });
          emit("task.passed", ctx, { commitSha: sha, attempts: i + 1 });
          const prUrl = deliver(task, ws);
          return {
            taskId: task.id, status: "passed", attempts: i + 1, commitSha: sha, ...(prUrl ? { prUrl } : {}),
          };
        }

        lastReason = describeFailure(next);
        retry = next;
      }
      return failTask(task, maxAttempts, lastReason, ws.branch);
    } catch (err) {
      return failTask(task, 0, `Unexpected error: ${errorMessage(err)}`, ws.branch);
    }
  }

  function failTask(task: Task, attempts: number, reason: string, branch?: string): TaskOutcome {
    store.upsertTask({ runId, taskId: task.id, title: task.title, status: "failed", ...(branch ? { branch } : {}) });
    emit("task.failed", { taskId: task.id }, { reason, attempts });
    return { taskId: task.id, status: "failed", attempts, reason };
  }
}

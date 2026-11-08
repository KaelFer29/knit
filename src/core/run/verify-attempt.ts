import type { Task } from "../plan/parse-plan.js";
import type { AgentRunResult } from "../ports/agent-runner.js";
import type { CheckRunner } from "../ports/check-runner.js";
import type { GitInspection, TaskWorkspace, Workspace } from "../ports/workspace.js";
import type { RetryContext } from "../prompt/render-prompt.js";
import { checkGit } from "../verification/check-git.js";
import { checkScope } from "../verification/check-scope.js";

/** How much of an agent's answer or a check's output an attempt row keeps. */
export const RESULT_TEXT_LIMIT = 2000;

export function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function processFailureText(result: AgentRunResult): string {
  if (result.timedOut) return "The agent timed out.";
  return `The agent process failed (exit code ${result.exitCode ?? "none"}): ${truncate(result.resultText, 500)}`;
}

/** One line saying why an attempt failed, from the first problem found. */
export function describeFailure(f: RetryContext): string {
  if (f.processFailure) return f.processFailure;
  if (f.scopeViolations?.length) return `Scope violations: ${f.scopeViolations.join(", ")}`;
  if (f.gitProblems?.length) return `Git problems: ${f.gitProblems.join(" ")}`;
  if (f.failedCheck) return `Check failed: ${f.failedCheck}`;
  return "Unknown failure";
}

export interface VerifyDeps {
  checks: CheckRunner;
  workspace: Workspace;
}

export interface VerifyInput {
  /** What the plan allows and requires of the task. */
  task: Pick<Task, "allowedFiles" | "checks">;
  ws: TaskWorkspace;
  /** What the agent process returned for this attempt. */
  result: AgentRunResult;
  checkTimeoutMs: number;
  /** Called right before each of the task's checks runs. */
  onCheckStarted?: (command: string) => void;
}

export interface AttemptVerdict {
  passed: boolean;
  /** Every problem found; empty when the attempt passed. Doubles as the context of a retry. */
  problems: RetryContext;
  /** Scope violations: paths outside the allowed files, and entries written next to the worktree. */
  violations: string[];
  gitProblems: string[];
  failedCheck?: string;
  inspection: GitInspection;
}

/**
 * Knit's verification of one attempt, shared by the run loop and by follow-ups: the agent process ended cleanly,
 * only allowed files changed, nothing was written next to the worktree, the git work is sound (branch, history,
 * commit format, nothing uncommitted), something changed, and every check of the task exits 0. The checks only run
 * when everything before them is clean, and the first failing one stops the rest. Deterministic: no model is called.
 */
export async function verifyAttempt(deps: VerifyDeps, input: VerifyInput): Promise<AttemptVerdict> {
  const { checks, workspace } = deps;
  const { task, ws, result, checkTimeoutMs } = input;

  const processOk = result.exitCode === 0 && !result.isError && !result.timedOut;
  const changed = workspace.changedPaths(ws);
  const violations = [...checkScope(changed, task.allowedFiles), ...workspace.outsideChanges(ws)];
  const inspection = workspace.inspect(ws);
  const gitProblems = checkGit(inspection, ws.branch);

  const problems: RetryContext = {};
  let failedCheck: string | undefined;
  if (!processOk) problems.processFailure = processFailureText(result);
  if (violations.length > 0) problems.scopeViolations = violations;
  if (gitProblems.length > 0) problems.gitProblems = gitProblems;
  const clean = processOk && violations.length === 0 && gitProblems.length === 0;
  if (clean && changed.length === 0) problems.processFailure = "No files were changed.";
  if (clean && changed.length > 0) {
    for (const command of task.checks) {
      input.onCheckStarted?.(command);
      const r = await checks.run(command, ws.path, checkTimeoutMs);
      if (r.exitCode !== 0 || r.timedOut) {
        failedCheck = command;
        problems.failedCheck = command;
        problems.output = r.timedOut ? `(timed out after ${checkTimeoutMs} ms)\n${r.output}` : r.output;
        break;
      }
    }
  }

  return {
    passed: Object.keys(problems).length === 0,
    problems,
    violations,
    gitProblems,
    ...(failedCheck !== undefined ? { failedCheck } : {}),
    inspection,
  };
}

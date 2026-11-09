import type { Task } from "../plan/parse-plan.js";

export interface RetryContext {
  /** The agent process itself failed (non-zero exit, timeout, error result, no changes). */
  processFailure?: string;
  /** Problems found in the agent's git work (branch, history, commit format, uncommitted files). */
  gitProblems?: string[];
  failedCheck?: string;
  /** Raw output of the failed check; only the tail is sent to the agent. */
  output?: string;
  /** Paths changed outside the task's allowed files. */
  scopeViolations?: string[];
}

const OUTPUT_TAIL_LINES = 40;

function bullets(items: string[]): string {
  return items.map((i) => `- ${i}`).join("\n");
}

function tail(text: string, lines: number): string {
  return text.replace(/\s+$/, "").split(/\r?\n/).slice(-lines).join("\n");
}

function renderRetryBlock(retry: RetryContext): string {
  const parts: string[] = ["Previous attempt failed."];
  if (retry.processFailure) parts.push(`Problem: ${retry.processFailure}`);
  if (retry.gitProblems && retry.gitProblems.length > 0) {
    parts.push(`Git problems to fix:\n${bullets(retry.gitProblems)}`);
  }
  if (retry.failedCheck) {
    parts.push(`Failed check: ${retry.failedCheck}`);
    if (retry.output) parts.push(`Last ${OUTPUT_TAIL_LINES} lines of its output:\n${tail(retry.output, OUTPUT_TAIL_LINES)}`);
  }
  if (retry.scopeViolations && retry.scopeViolations.length > 0) {
    parts.push(`Files changed outside the allowed list (revert them):\n${bullets(retry.scopeViolations)}`);
  }
  parts.push("Fix the problem and keep to the specs and allowed files above.");
  return parts.join("\n\n");
}

/** Renders the implementer prompt for one attempt (rules: docs/run-lifecycle.md). */
export function renderPrompt(task: Task, retry?: RetryContext): string {
  const specs = bullets(task.specs.map((s) => `${s.id}: ${s.text}`));
  const sections = [
    "You are the implementer for one task. Work only inside the current directory.",
    `Task: ${task.id} - ${task.title}\nGoal: ${task.goal}`,
    `Specs (implement exactly these, add nothing else):\n${specs}`,
    `Allowed files (create or edit only these; touch nothing else):\n${bullets(task.allowedFiles)}`,
    [
      "Rules:",
      "- Do not write outside the current directory.",
      "- Do not install dependencies unless a spec says so.",
      "- When finished, reply in English with: files changed, and which spec IDs you covered.",
    ].join("\n"),
    [
      "Git rules:",
      `- You are on branch ${task.branch}. Stay on it. Do not switch, create or delete branches. Do not push.`,
      "- Do not amend, rebase, reset or otherwise rewrite history.",
      "- Commit your work yourself, grouped by sub-functionality: one commit per cohesive piece of work, not one per file and not one for everything.",
      "- Commit message format: type(scope): description. It must be a single line with no body and no trailers. type is one of feat, fix, refactor, docs, chore, test. scope is optional and uses only lowercase letters and hyphens. Never add Co-authored-by lines.",
      "- Leave the working tree clean when you finish: everything committed.",
    ].join("\n"),
  ];
  if (retry) sections.push(renderRetryBlock(retry));
  return sections.join("\n\n") + "\n";
}

/**
 * What a resumed chat is told after a failed attempt: only what went wrong. The chat already holds the task, its specs,
 * the allowed files and the rules, so none of that is sent again.
 */
export function renderContinuationPrompt(retry: RetryContext): string {
  return [
    "Your previous attempt did not pass Knit's verification. The task, its specs, the allowed files and the rules are unchanged.",
    renderRetryBlock(retry),
    "Fix exactly these problems, commit your work as before and reply as before: files changed, and which spec IDs you covered.",
  ].join("\n\n") + "\n";
}


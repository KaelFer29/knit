import type { RunDetail, StoredAgentEvent, StoredRun } from "../../adapters/storage/sqlite/run-store.js";
import type { EventRecord } from "../../core/ports/run-store.js";
import type { SessionEventRecord } from "../../core/ports/session-store.js";

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

export function formatRunLine(r: StoredRun): string {
  return `${r.id}  ${r.status.padEnd(7)}  ${r.planName}  (${r.startedAt})`;
}

export function formatRunDetail(d: RunDetail): string {
  const { run, tasks, attempts } = d;
  const lines = [
    `Run ${run.id} - ${run.status}`,
    `Plan:    ${run.planPath}`,
    `Repo:    ${run.repo}  base ${run.base}`,
    `Started: ${run.startedAt}${run.finishedAt ? `  finished ${run.finishedAt}` : ""}`,
    "",
  ];
  let tokensIn = 0;
  let tokensOut = 0;
  let agentMs = 0;
  for (const t of tasks) {
    const extra = [t.branch ? `branch ${t.branch}` : "", t.commitSha ? `commit ${t.commitSha.slice(0, 8)}` : "", t.prUrl ? `pr ${t.prUrl}` : ""]
      .filter(Boolean)
      .join("  ");
    lines.push(`${t.taskId}  ${t.status.padEnd(7)}  ${t.title}${extra ? `  [${extra}]` : ""}`);
    for (const a of attempts.filter((x) => x.taskId === t.taskId)) {
      tokensIn += a.inputTokens ?? 0;
      tokensOut += a.outputTokens ?? 0;
      agentMs += a.durationMs;
      const bits = [
        a.attempt === 0 ? "setup" : `attempt ${a.attempt}`,
        a.status,
        formatDuration(a.durationMs),
        `${a.inputTokens ?? 0} in / ${a.outputTokens ?? 0} out tokens`,
        a.scopeOk ? "" : "scope violation",
        a.failedCheck ? `failed: ${a.failedCheck}` : "",
      ].filter(Boolean);
      lines.push(`    ${bits.join("  ")}`);
    }
  }
  lines.push("", `Totals: ${tokensIn} in / ${tokensOut} out tokens, agent time ${formatDuration(agentMs)}`);
  return lines.join("\n");
}

/** One-line live progress for the terminal; returns undefined for events not worth printing. */
export function formatProgress(e: EventRecord): string | undefined {
  const who = e.taskId ? `[${e.taskId}] ` : "";
  const p = (e.payload ?? {}) as Record<string, unknown>;
  switch (e.type) {
    case "run.started":
      return `Run started: ${String(p.tasks)} task(s) in ${String(p.repo)}`;
    case "run.resumed":
      return `Run resumed: ${String(p.tasks)} task(s) in ${String(p.repo)}`;
    case "task.reused":
      return `${who}already passed, reusing ${String(p.branch)}`;
    case "push.finished":
      return `${who}pushed ${String(p.branch)}`;
    case "push.failed":
      return `${who}push FAILED: ${String(p.error)}`;
    case "pr.created":
      return `${who}pull request: ${String(p.url)} (base ${String(p.base)})`;
    case "pr.failed":
      return `${who}pull request FAILED: ${String(p.error)}`;
    case "task.started":
      return `${who}started on ${String(p.branch)}`;
    case "setup.started":
      return `${who}setup: ${String(p.command)}`;
    case "attempt.started":
      return `${who}attempt ${e.attempt}: agent running`;
    case "agent.tool_call":
      return p.subtype === "started" ? `${who}  tool: ${String(p.tool ?? "?")}` : undefined;
    case "check.started":
      return `${who}check: ${String(p.command)}`;
    case "attempt.finished":
      return `${who}attempt ${e.attempt}: ${p.passed ? "passed" : "failed"}`;
    case "followup.started":
      return `${who}follow-up: resuming the agent's chat as attempt ${e.attempt}`;
    case "task.passed":
      return `${who}passed (commit ${String(p.commitSha).slice(0, 8)})`;
    case "task.failed":
      return `${who}FAILED: ${String(p.reason)}`;
    case "run.finished":
      return `Run finished: ${String(p.status)}`;
    default:
      return undefined;
  }
}

const oneLine = (text: string, max = 300): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

const shortJson = (value: unknown): string => (value === undefined ? "" : oneLine(JSON.stringify(value)));

/** One readable line of the agent's timeline, for `knit logs`. */
export function formatAgentEvent(e: StoredAgentEvent): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const time = e.ts.slice(11, 19);
  const who = e.taskId ? `[${e.taskId}#${e.attempt ?? 0}]` : "[run]";
  const text = (key: string): string => oneLine(String(p[key] ?? ""));
  let body: string;
  switch (e.kind) {
    case "thinking":
      body = `thinking  ${text("text")}`;
      break;
    case "message":
      body = `message   ${text("text")}`;
      break;
    case "prompt":
      body = `prompt    ${oneLine(String(p.text ?? ""), 120)}`;
      break;
    case "system":
      body = `system    model ${String(p.model ?? "?")}`;
      break;
    case "tool_started":
      body = `tool ▶    ${String(p.tool)} ${shortJson(p.args)}`;
      break;
    case "tool_completed":
      body = `tool ✓    ${String(p.tool)} ${shortJson(p.result)}`;
      break;
    case "result": {
      const usage = (p.usage ?? {}) as { inputTokens?: number; outputTokens?: number };
      body = `result    ${text("text")} (${p.durationMs ?? "?"}ms, ${usage.inputTokens ?? 0} in / ${usage.outputTokens ?? 0} out)`;
      break;
    }
    default:
      body = `${e.kind.padEnd(9)} ${String(p.type ?? "")}`;
  }
  return `${time} ${who} ${body}`.trimEnd();
}

/** The line `knit logs` would print for a session's timeline entry, without its `[run]` label (a session has no tasks). */
export function formatSessionEvent(e: SessionEventRecord): string {
  const stored: StoredAgentEvent = { id: 0, runId: e.sessionId, ts: e.ts, kind: e.kind, agent: e.agent, ...(e.payload !== undefined ? { payload: e.payload } : {}) };
  return formatAgentEvent(stored).replace(" [run] ", " ");
}

import type {
  AgentCapabilities,
  AgentEvent,
  AgentRunRequest,
  AgentRunResult,
  AgentRunner,
} from "../../../core/ports/agent-runner.js";
import { spawnWithTimeout } from "../../system/spawn-with-timeout.js";

export interface CursorRunnerOptions {
  /** Binary to run. Default: `agent` (installed by the Cursor CLI). */
  command?: string;
  /** Arguments placed before the headless flags (used by tests to run a fake script). */
  prefixArgs?: string[];
  /** Optional `--model` value. */
  model?: string;
  killGraceMs?: number;
}

interface ResultEvent {
  is_error?: boolean;
  result?: string;
  session_id?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

function tailLines(text: string, count: number): string {
  return text.trim().split(/\r?\n/).slice(-count).join("\n");
}

/**
 * Adapter for the Cursor CLI in headless mode.
 * Verified in the spike: `agent -p --force --output-format stream-json "<prompt>"` with stdin closed.
 * `--force` also satisfies the workspace-trust prompt that a fresh worktree triggers.
 */
export class CursorAgentRunner implements AgentRunner {
  readonly name = "cursor";
  /** What this adapter supports today: resume and the command and usage reports are not wired yet. */
  readonly capabilities: AgentCapabilities = {
    resume: false,
    chooseModel: true,
    commandList: false,
    visibleReasoning: true,
    planUsage: false,
  };
  private readonly command: string;
  private readonly prefixArgs: string[];
  private readonly model?: string;
  private readonly killGraceMs?: number;

  constructor(options: CursorRunnerOptions = {}) {
    this.command = options.command ?? "agent";
    this.prefixArgs = options.prefixArgs ?? [];
    if (options.model) this.model = options.model;
    if (options.killGraceMs !== undefined) this.killGraceMs = options.killGraceMs;
  }

  async run(request: AgentRunRequest, onEvent?: (event: AgentEvent) => void): Promise<AgentRunResult> {
    const args = [
      ...this.prefixArgs,
      "-p",
      "--force",
      "--output-format",
      "stream-json",
      ...(this.model ? ["--model", this.model] : []),
      request.prompt,
    ];

    let resultEvent: ResultEvent | undefined;
    let initSessionId: string | undefined;

    const res = await spawnWithTimeout(this.command, args, {
      cwd: request.cwd,
      timeoutMs: request.timeoutMs,
      ...(this.killGraceMs !== undefined ? { killGraceMs: this.killGraceMs } : {}),
      onStdoutLine: (line) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          return; // progress noise, not an event
        }
        if (typeof parsed !== "object" || parsed === null) return;
        const type = (parsed as { type?: unknown }).type;
        if (typeof type !== "string") return;
        if (type === "result") resultEvent = parsed as ResultEvent;
        if (type === "system" && typeof (parsed as ResultEvent).session_id === "string") {
          initSessionId = (parsed as ResultEvent).session_id;
        }
        onEvent?.({ type, raw: parsed });
      },
    });

    const cleanExit = res.exitCode === 0 && !res.timedOut && !res.spawnError;
    const isError = !cleanExit || !resultEvent || resultEvent.is_error === true;

    let resultText: string;
    if (res.spawnError) resultText = `Could not start '${this.command}': ${res.spawnError}`;
    else if (res.timedOut) resultText = `Agent timed out after ${request.timeoutMs} ms`;
    else if (resultEvent?.result !== undefined) resultText = resultEvent.result;
    else if (res.stderr.trim()) resultText = tailLines(res.stderr, 20);
    else resultText = "Agent produced no result event";

    const sessionId = resultEvent?.session_id ?? initSessionId;
    return {
      exitCode: res.exitCode,
      isError,
      resultText,
      durationMs: res.durationMs,
      timedOut: res.timedOut,
      ...(resultEvent?.usage?.inputTokens !== undefined ? { inputTokens: resultEvent.usage.inputTokens } : {}),
      ...(resultEvent?.usage?.outputTokens !== undefined ? { outputTokens: resultEvent.usage.outputTokens } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
    };
  }
}

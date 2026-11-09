import { contextTokensOf, type TurnUsage } from "../../../core/context/index.js";
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
  usage?: TurnUsage;
}

function tailLines(text: string, count: number): string {
  return text.trim().split(/\r?\n/).slice(-count).join("\n");
}

const LIST_MODELS_TIMEOUT_MS = 15_000;
/** Zero-width characters the CLI appends to some model labels. */
const INVISIBLE = /[\u200b-\u200f\u2060\ufeff]/g;
/** `<id> - <label>`: the only shape of a model line. The title, the blank line and the tip never match it. */
const MODEL_LINE = /^([A-Za-z0-9][\w.[\],=-]*) - \S/;

/** The model ids in the output of `agent models`, in the order printed, ignoring every line that is not a model. */
export function parseModelList(output: string): string[] {
  const ids: string[] = [];
  for (const line of output.replace(INVISIBLE, "").split(/\r?\n/)) {
    const id = MODEL_LINE.exec(line.trim())?.[1];
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Adapter for the Cursor CLI in headless mode.
 * Verified in the spike: `agent -p --force --output-format stream-json "<prompt>"` with stdin closed.
 * `--force` also satisfies the workspace-trust prompt that a fresh worktree triggers.
 * Verified against the real CLI (see docs/web-interface.md): the init and result events carry the chat id as
 * `session_id`, and `agent -p --resume <chatId> "<prompt>"` continues that conversation and keeps the id.
 */
export class CursorAgentRunner implements AgentRunner {
  readonly name = "cursor";
  /**
   * Resume is verified. The headless CLI has no command list (a slash command sent with `-p` reaches the model as
   * plain text) and its stream reports tokens but never plan usage, so those two stay false.
   */
  readonly capabilities: AgentCapabilities = {
    resume: true,
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
    const model = request.profile?.model || this.model;
    const args = [
      ...this.prefixArgs,
      "-p",
      "--force",
      "--output-format",
      "stream-json",
      ...(model ? ["--model", model] : []),
      ...(request.resumeSessionId ? ["--resume", request.resumeSessionId] : []),
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
      ...(contextTokensOf(resultEvent?.usage) !== undefined ? { contextTokens: contextTokensOf(resultEvent?.usage)! } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
    };
  }

  /** Asks the CLI (`agent models`). An empty list when it fails or prints nothing recognizable. */
  async listModels(): Promise<string[]> {
    const res = await spawnWithTimeout(this.command, [...this.prefixArgs, "models"], {
      cwd: process.cwd(),
      timeoutMs: LIST_MODELS_TIMEOUT_MS,
      ...(this.killGraceMs !== undefined ? { killGraceMs: this.killGraceMs } : {}),
    });
    if (res.spawnError || res.timedOut || res.exitCode !== 0) return [];
    return parseModelList(res.stdout);
  }
}

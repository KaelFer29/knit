import type {
  AgentCapabilities,
  AgentEvent,
  AgentPlanUsage,
  PlanWindow,
  AgentProfile,
  AgentRunMeta,
  AgentRunRequest,
  AgentRunResult,
  AgentRunner,
} from "../../../core/ports/agent-runner.js";
import { tmpdir } from "node:os";
import { claudeTokenUsage } from "../../../core/timeline/normalize-claude-events.js";
import { spawnWithTimeout } from "../../system/spawn-with-timeout.js";
import { parseUsageText } from "./usage-text.js";

export interface ClaudeRunnerOptions {
  /** Binary to run. Default: `claude`. */
  command?: string;
  /** Arguments placed before the headless flags (used by tests to run a fake script). */
  prefixArgs?: string[];
  /** Default `--model` value; a request's `profile.model` wins. */
  model?: string;
  /** Default `--effort` value; a request's `profile.effort` wins. */
  effort?: string;
  /** Default `--permission-mode` value; a request's `profile.permissionMode` wins. */
  permissionMode?: string;
  /** Default session to continue with `--resume`; a request's `resumeSessionId` wins. */
  resumeSessionId?: string;
  /**
   * Adds `--strict-mcp-config`, which ignores every MCP server the user configured. Off by default:
   * Claude sessions use the user's normal configuration (CLAUDE.md, rules, skills, MCP servers).
   * Meant for tests and probes that must not start the user's MCP servers.
   */
  strictMcp?: boolean;
  killGraceMs?: number;
}

interface ResultEvent {
  is_error?: boolean;
  result?: string;
  errors?: unknown;
  session_id?: string;
  usage?: unknown;
}

/**
 * Values `--model` accepts. The aliases are the ones `claude --help` documents (it names `fable`, `opus` and
 * `sonnet`; `haiku` is accepted too); the full ids are ones real streams reported in their init and usage events.
 * Static on purpose: asking the CLI would be a real call.
 */
const MODELS = ["sonnet", "opus", "haiku", "fable", "claude-sonnet-5-5", "claude-haiku-5-5"];

const WINDOWS = ["five_hour", "seven_day"] as const;

/** `/usage` answers in about half a second; this only guards against a hung CLI. */
const USAGE_TIMEOUT_MS = 30_000;

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

function tailLines(text: string, count: number): string {
  return text.trim().split(/\r?\n/).slice(-count).join("\n");
}

/** `slash_commands` minus `terminal_slash_commands`: the commands that make sense outside a terminal. */
function commandsOf(init: Rec): string[] | undefined {
  if (!Array.isArray(init.slash_commands)) return undefined;
  const terminalOnly = new Set(Array.isArray(init.terminal_slash_commands) ? init.terminal_slash_commands : []);
  return init.slash_commands.filter((c): c is string => typeof c === "string" && !terminalOnly.has(c));
}

/** The windows of one `rate_limit_event`, in a stable order (five_hour, then seven_day). */
function planUsageOf(event: Rec): AgentPlanUsage[] {
  const info = event.rate_limit_info;
  const windows = isRecord(info) && isRecord(info.unifiedWindows) ? info.unifiedWindows : {};
  const out: AgentPlanUsage[] = [];
  for (const name of WINDOWS) {
    const w = windows[name];
    if (!isRecord(w) || typeof w.utilization !== "number") continue;
    out.push({ name, utilization: w.utilization, ...(typeof w.resetsAt === "number" ? { resetsAt: w.resetsAt } : {}) });
  }
  return out;
}

/**
 * Adapter for Claude Code in headless mode: `claude -p --output-format stream-json --verbose`.
 * It runs with the user's normal Claude configuration (no `--bare`) so a session behaves as it does
 * in a terminal, and the user's subscription pays for it (no API key involved).
 *
 * Token counting: `inputTokens` is `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
 * of the final `result` event (see `claudeTokenUsage`). That event's usage is cumulative over every
 * request of the turn, so the cached prompt is counted once per request.
 */
export class ClaudeAgentRunner implements AgentRunner {
  readonly name = "claude";
  readonly capabilities: AgentCapabilities = {
    resume: true,
    chooseModel: true,
    commandList: true,
    // Headless Claude sends its reasoning blocks empty (only a signature).
    visibleReasoning: false,
    planUsage: true,
  };
  private readonly command: string;
  private readonly prefixArgs: string[];
  private readonly defaults: AgentProfile;
  private readonly resumeSessionId?: string;
  private readonly strictMcp: boolean;
  private readonly killGraceMs?: number;

  constructor(options: ClaudeRunnerOptions = {}) {
    this.command = options.command ?? "claude";
    this.prefixArgs = options.prefixArgs ?? [];
    this.defaults = {
      ...(options.model ? { model: options.model } : {}),
      ...(options.effort ? { effort: options.effort } : {}),
      ...(options.permissionMode ? { permissionMode: options.permissionMode } : {}),
    };
    if (options.resumeSessionId) this.resumeSessionId = options.resumeSessionId;
    this.strictMcp = options.strictMcp === true;
    if (options.killGraceMs !== undefined) this.killGraceMs = options.killGraceMs;
  }

  async listModels(): Promise<string[]> {
    return [...MODELS];
  }

  /**
   * Runs `/usage` in print mode: a local command of Claude Code, so it makes no model call (cost 0), and
   * `--no-session-persistence` keeps it out of the session list. Reads the windows from the text it prints.
   */
  async readPlanUsage(): Promise<PlanWindow[]> {
    const args = [...this.prefixArgs, "-p", "--output-format", "json", "--no-session-persistence", "--", "/usage"];
    const res = await spawnWithTimeout(this.command, args, { cwd: tmpdir(), timeoutMs: USAGE_TIMEOUT_MS, ...(this.killGraceMs !== undefined ? { killGraceMs: this.killGraceMs } : {}) });
    if (res.spawnError || res.timedOut || res.exitCode !== 0) {
      throw new Error(`Could not read the plan usage: ${res.spawnError ?? (res.timedOut ? "timed out" : `exit code ${res.exitCode}`)}`);
    }
    let text = "";
    try {
      const parsed: unknown = JSON.parse(res.stdout);
      if (isRecord(parsed) && typeof parsed.result === "string") text = parsed.result;
    } catch {
      throw new Error("Could not read the plan usage: the answer was not JSON");
    }
    return parseUsageText(text);
  }

  async run(request: AgentRunRequest, onEvent?: (event: AgentEvent) => void): Promise<AgentRunResult> {
    const profile = { ...this.defaults, ...definedOnly(request.profile) };
    const resume = request.resumeSessionId ?? this.resumeSessionId;
    const args = [
      ...this.prefixArgs,
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      ...(this.strictMcp ? ["--strict-mcp-config"] : []),
      ...(profile.model ? ["--model", profile.model] : []),
      ...(profile.effort ? ["--effort", profile.effort] : []),
      ...(profile.permissionMode ? ["--permission-mode", profile.permissionMode] : []),
      ...(resume ? ["--resume", resume] : []),
      // `--` keeps a prompt that starts with a dash from being read as a flag.
      "--",
      request.prompt,
    ];

    let resultEvent: ResultEvent | undefined;
    let initSessionId: string | undefined;
    let commands: string[] | undefined;
    let model: string | undefined;
    const usage = new Map<string, AgentPlanUsage>();

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
        if (!isRecord(parsed) || typeof parsed.type !== "string") return;
        if (parsed.type === "result") resultEvent = parsed as ResultEvent;
        if (parsed.type === "system" && parsed.subtype === "init") {
          if (typeof parsed.session_id === "string") initSessionId = parsed.session_id;
          if (typeof parsed.model === "string") model = parsed.model;
          commands = commandsOf(parsed) ?? commands;
        }
        if (parsed.type === "rate_limit_event") for (const w of planUsageOf(parsed)) usage.set(w.name, w);
        onEvent?.({ type: parsed.type, raw: parsed });
      },
    });

    const cleanExit = res.exitCode === 0 && !res.timedOut && !res.spawnError;
    const isError = !cleanExit || !resultEvent || resultEvent.is_error === true;

    let resultText: string;
    if (res.spawnError) resultText = `Could not start '${this.command}': ${res.spawnError}`;
    else if (res.timedOut) resultText = `Agent timed out after ${request.timeoutMs} ms`;
    else if (typeof resultEvent?.result === "string") resultText = resultEvent.result;
    else if (Array.isArray(resultEvent?.errors) && resultEvent.errors.length > 0) resultText = resultEvent.errors.join("\n");
    else if (res.stderr.trim()) resultText = tailLines(res.stderr, 20);
    else resultText = "Agent produced no result event";

    const tokens = claudeTokenUsage(resultEvent?.usage);
    const sessionId = resultEvent?.session_id ?? initSessionId;
    const meta: AgentRunMeta = {
      ...(commands ? { commands } : {}),
      ...(usage.size > 0 ? { planUsage: WINDOWS.flatMap((n) => usage.get(n) ?? []) } : {}),
      ...(model ? { model } : {}),
    };
    return {
      exitCode: res.exitCode,
      isError,
      resultText,
      durationMs: res.durationMs,
      timedOut: res.timedOut,
      ...(tokens ? { inputTokens: tokens.inputTokens, outputTokens: tokens.outputTokens } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(Object.keys(meta).length > 0 ? { meta } : {}),
    };
  }
}

function definedOnly(profile: AgentProfile | undefined): AgentProfile {
  return Object.fromEntries(Object.entries(profile ?? {}).filter(([, v]) => v !== undefined && v !== "")) as AgentProfile;
}

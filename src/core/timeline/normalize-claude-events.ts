import {
  DEFAULT_MAX_STRING_CHARS,
  clipValue,
  type AgentLogEntry,
  type NormalizerOptions,
} from "./normalize-agent-events.js";

/**
 * Normalizes Claude Code's `--output-format stream-json` into the same `AgentLogEntry` kinds the
 * Cursor normalizer produces, so one timeline component renders both agents.
 *
 * Differences from Cursor's stream that this handles:
 * - Claude has no delta events: each assistant event carries finished content blocks.
 * - `thinking` blocks arrive with an empty `thinking` string (only a signature) in headless mode.
 *   They become a `thinking` entry with `shared: false` so the interface can say the agent did not
 *   share its reasoning; readable text is emitted with `shared: true`.
 * - A tool call is a `tool_use` block in an assistant event and its answer is a `tool_result` block
 *   in a later user event, matched by id.
 */

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

export interface ClaudeTokenUsage {
  /** New input tokens plus cache-creation plus cache-read tokens (everything sent to the model). */
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Reads a Claude `usage` object. Claude splits the prompt into `input_tokens` (not cached),
 * `cache_creation_input_tokens` and `cache_read_input_tokens`; Knit reports `inputTokens` as the
 * sum of the three so it means "tokens the model read", and keeps the cache parts apart.
 * The `result` event's usage is cumulative over every request of the turn, so a turn that calls
 * tools re-reads the cached prompt each time and its input total grows accordingly.
 */
export function claudeTokenUsage(usage: unknown): ClaudeTokenUsage | undefined {
  if (!isRecord(usage)) return undefined;
  const cacheCreationTokens = count(usage.cache_creation_input_tokens);
  const cacheReadTokens = count(usage.cache_read_input_tokens);
  return {
    inputTokens: count(usage.input_tokens) + cacheCreationTokens + cacheReadTokens,
    outputTokens: count(usage.output_tokens),
    cacheCreationTokens,
    cacheReadTokens,
  };
}

function textParts(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p): p is Rec => isRecord(p) && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
}

export class ClaudeEventNormalizer {
  /** Tool names by call id, to label the result that arrives later. */
  private readonly toolNames = new Map<string, string>();
  private readonly maxString: number;

  constructor(options: NormalizerOptions = {}) {
    this.maxString = options.maxStringChars ?? DEFAULT_MAX_STRING_CHARS;
  }

  /** Feeds one raw event; returns the entries that are ready (possibly none). */
  push(raw: unknown): AgentLogEntry[] {
    if (!isRecord(raw) || typeof raw.type !== "string") return [];
    switch (raw.type) {
      case "system":
        return [raw.subtype === "init" ? this.mapInit(raw) : this.mapOther(raw)];
      case "assistant":
        return this.mapAssistant(raw);
      case "user":
        return this.mapUser(raw);
      case "result":
        return [this.mapResult(raw)];
      default:
        return [this.mapOther(raw)];
    }
  }

  /** Nothing is buffered between events; kept so both normalizers share one shape. */
  flush(): AgentLogEntry[] {
    return [];
  }

  private mapInit(raw: Rec): AgentLogEntry {
    return {
      kind: "system",
      payload: this.defined({ model: raw.model, permissionMode: raw.permissionMode, sessionId: raw.session_id }),
    };
  }

  private mapOther(raw: Rec): AgentLogEntry {
    return {
      kind: "other",
      payload: this.defined({ type: raw.type, subtype: raw.subtype, raw: this.clip(raw) }),
    };
  }

  private mapAssistant(raw: Rec): AgentLogEntry[] {
    const content = (raw.message as Rec | undefined)?.content;
    if (!Array.isArray(content)) return [];
    const parent = this.parentOf(raw);
    const entries: AgentLogEntry[] = [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === "thinking") {
        const text = typeof block.thinking === "string" ? block.thinking : "";
        entries.push({ kind: "thinking", payload: { text: this.clip(text), shared: text !== "", ...parent } });
      } else if (block.type === "text") {
        if (typeof block.text === "string" && block.text !== "") {
          entries.push({ kind: "message", payload: { text: this.clip(block.text), ...parent } });
        }
      } else if (block.type === "tool_use") {
        const callId = typeof block.id === "string" ? block.id : undefined;
        const tool = typeof block.name === "string" ? block.name : "unknown";
        if (callId !== undefined) this.toolNames.set(callId, tool);
        entries.push({
          kind: "tool_started",
          payload: this.defined({ tool, callId, args: this.clip(block.input), ...parent }),
        });
      }
    }
    return entries;
  }

  private mapUser(raw: Rec): AgentLogEntry[] {
    const content = (raw.message as Rec | undefined)?.content;
    const parent = this.parentOf(raw);
    if (typeof content === "string") return [{ kind: "prompt", payload: { text: this.clip(content), ...parent } }];
    if (!Array.isArray(content)) return [];
    const entries: AgentLogEntry[] = [];
    const text = textParts(content);
    for (const block of content) {
      if (!isRecord(block) || block.type !== "tool_result") continue;
      const callId = typeof block.tool_use_id === "string" ? block.tool_use_id : undefined;
      entries.push({
        kind: "tool_completed",
        payload: this.defined({
          tool: callId !== undefined ? this.toolNames.get(callId) : undefined,
          callId,
          result: this.clip(block.content),
          isError: block.is_error === true ? true : undefined,
          ...parent,
        }),
      });
    }
    if (entries.length === 0 && text !== "") entries.push({ kind: "prompt", payload: { text: this.clip(text), ...parent } });
    return entries;
  }

  private mapResult(raw: Rec): AgentLogEntry {
    return {
      kind: "result",
      payload: this.defined({
        text: this.clip(raw.result),
        isError: raw.is_error,
        durationMs: raw.duration_ms,
        usage: claudeTokenUsage(raw.usage),
      }),
    };
  }

  private parentOf(raw: Rec): Rec {
    return typeof raw.parent_tool_use_id === "string" ? { parentCallId: raw.parent_tool_use_id } : {};
  }

  private defined(obj: Rec): Rec {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
  }

  private clip(value: unknown): unknown {
    return clipValue(value, this.maxString);
  }
}

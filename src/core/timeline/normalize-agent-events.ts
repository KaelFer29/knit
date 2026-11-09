/**
 * Turns the agent's raw stream events into a compact, UI-friendly timeline:
 * thinking deltas are coalesced into blocks, tool calls carry name/arguments/result,
 * and very long strings are clipped (the full stream is kept in the raw transcript).
 */
export type AgentLogKind =
  | "system"
  | "prompt"
  | "thinking"
  | "message"
  | "tool_started"
  | "tool_completed"
  | "result"
  | "other";

export interface AgentLogEntry {
  kind: AgentLogKind;
  payload: Record<string, unknown>;
}

export interface NormalizerOptions {
  /** Flush a thinking block once it has this many characters (default 240). */
  thinkingFlushChars?: number;
  /** Strings longer than this are clipped (default 4000). */
  maxStringChars?: number;
}

/** Strings longer than this are clipped unless the caller says otherwise. */
export const DEFAULT_MAX_STRING_CHARS = 4000;

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((p): p is Rec => isRecord(p) && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
}

export class AgentEventNormalizer {
  private thinking = "";
  private readonly flushChars: number;
  private readonly maxString: number;

  constructor(options: NormalizerOptions = {}) {
    this.flushChars = options.thinkingFlushChars ?? 240;
    this.maxString = options.maxStringChars ?? DEFAULT_MAX_STRING_CHARS;
  }

  /** Feeds one raw event; returns the entries that are ready (possibly none). */
  push(raw: unknown): AgentLogEntry[] {
    if (!isRecord(raw) || typeof raw.type !== "string") return [];

    if (raw.type === "thinking") {
      if (raw.subtype === "delta" && typeof raw.text === "string") {
        this.thinking += raw.text;
        return this.thinking.length >= this.flushChars ? this.flush() : [];
      }
      return raw.subtype === "completed" ? this.flush() : [];
    }

    const entries = this.flush();
    const mapped = this.map(raw);
    return mapped ? [...entries, mapped] : entries;
  }

  /** Returns any buffered thinking; call at the end of an attempt. */
  flush(): AgentLogEntry[] {
    if (this.thinking === "") return [];
    const text = this.thinking;
    this.thinking = "";
    return [{ kind: "thinking", payload: { text: this.clip(text) } }];
  }

  private map(raw: Rec): AgentLogEntry | undefined {
    switch (raw.type) {
      case "system":
        return {
          kind: "system",
          payload: this.defined({ model: raw.model, permissionMode: raw.permissionMode, sessionId: raw.session_id }),
        };
      case "user":
        return { kind: "prompt", payload: { text: this.clip(textOf((raw.message as Rec | undefined)?.content)) } };
      case "assistant":
        return { kind: "message", payload: { text: this.clip(textOf((raw.message as Rec | undefined)?.content)) } };
      case "tool_call":
        return this.mapToolCall(raw);
      case "result":
        return {
          kind: "result",
          payload: this.defined({
            text: this.clip(raw.result),
            isError: raw.is_error,
            durationMs: raw.duration_ms,
            usage: raw.usage,
          }),
        };
      default:
        return {
          kind: "other",
          payload: this.defined({ type: raw.type, subtype: raw.subtype, raw: this.clip(raw) }),
        };
    }
  }

  private mapToolCall(raw: Rec): AgentLogEntry {
    const tc = isRecord(raw.tool_call) ? raw.tool_call : {};
    const keys = Object.keys(tc).filter((k) => k !== "hookAdditionalContexts");
    const tool = keys.find((k) => /ToolCall$/.test(k)) ?? keys[0] ?? "unknown";
    const body = isRecord(tc[tool]) ? (tc[tool] as Rec) : {};
    if (raw.subtype === "completed") {
      return {
        kind: "tool_completed",
        payload: this.defined({ tool, callId: raw.call_id, result: this.clip(body.result) }),
      };
    }
    return { kind: "tool_started", payload: this.defined({ tool, callId: raw.call_id, args: this.clip(body.args) }) };
  }

  private defined(obj: Rec): Rec {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
  }

  private clip(value: unknown): unknown {
    return clipValue(value, this.maxString);
  }
}

/** Clips every string longer than `maxString` anywhere inside `value`, saying how much was cut. */
export function clipValue(value: unknown, maxString: number, depth = 0): unknown {
  if (typeof value === "string") {
    return value.length > maxString ? `${value.slice(0, maxString)}… [truncated ${value.length - maxString} chars]` : value;
  }
  if (depth > 8) return "[max depth]";
  if (Array.isArray(value)) return value.map((v) => clipValue(v, maxString, depth + 1));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clipValue(v, maxString, depth + 1)]));
  }
  return value;
}

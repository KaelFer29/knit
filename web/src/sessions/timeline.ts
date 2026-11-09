import type { SessionEvent, Turn } from "./types";

/** What the timeline draws. One shape for every agent: the item kinds come from the shared normalized timeline. */
export type TimelineItem =
  | { type: "prompt"; key: string; seq: number; text: string; model?: string; at: string }
  | { type: "message"; key: string; text: string; at: string }
  | { type: "thinking"; key: string; text: string; shared: boolean }
  | { type: "tool"; key: string; tool: string; args?: string; result?: string; isError: boolean; done: boolean }
  | { type: "result"; key: string; text: string; isError: boolean; durationMs?: number; inputTokens?: number; outputTokens?: number }
  | { type: "working"; key: string };

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Strings are shown as they are; anything else as indented JSON. Untrusted values only ever become text. */
function show(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Builds the items of a session from its turns and their events: each turn starts with its prompt, tool calls are
 * paired with their result by call id, and a turn that is still running ends with a working marker. A finished turn
 * with no result entry (killed, timed out) gets one from the turn itself, so a failure never disappears.
 */
export function buildTimeline(turns: Turn[], events: SessionEvent[]): TimelineItem[] {
  const byTurn = new Map<number, SessionEvent[]>();
  for (const e of events) byTurn.set(e.turnId, [...(byTurn.get(e.turnId) ?? []), e]);

  const items: TimelineItem[] = [];
  for (const turn of turns) {
    items.push({ type: "prompt", key: `turn-${turn.id}`, seq: turn.seq, text: turn.prompt, ...(turn.profile?.model ? { model: turn.profile.model } : {}), at: turn.startedAt });
    const open = new Map<string, Extract<TimelineItem, { type: "tool" }>>();
    let hasResult = false;
    // The agent's closing text is usually the last thing it wrote: showing it twice reads like a bug.
    const lastMessage = (): string => {
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]!;
        if (item.type === "prompt") break;
        if (item.type === "message") return item.text.trim();
      }
      return "";
    };
    const closing = (text: string): string => (text.trim() !== "" && text.trim() === lastMessage() ? "" : text);
    for (const e of byTurn.get(turn.id) ?? []) {
      const p = isRecord(e.payload) ? e.payload : {};
      const key = `event-${e.id}`;
      switch (e.kind) {
        case "message":
          if (str(p.text) !== "") items.push({ type: "message", key, text: str(p.text), at: e.ts });
          break;
        case "thinking": {
          const text = str(p.text);
          items.push({ type: "thinking", key, text, shared: typeof p.shared === "boolean" ? p.shared : text !== "" });
          break;
        }
        case "tool_started": {
          const args = show(p.args);
          const item: Extract<TimelineItem, { type: "tool" }> = { type: "tool", key, tool: str(p.tool) || "tool", ...(args ? { args } : {}), isError: false, done: false };
          items.push(item);
          if (str(p.callId) !== "") open.set(str(p.callId), item);
          break;
        }
        case "tool_completed": {
          const result = show(p.result);
          const started = open.get(str(p.callId));
          if (started) {
            started.done = true;
            started.isError = p.isError === true;
            if (result) started.result = result;
          } else {
            items.push({ type: "tool", key, tool: str(p.tool) || "tool", ...(result ? { result } : {}), isError: p.isError === true, done: true });
          }
          break;
        }
        case "result": {
          hasResult = true;
          items.push({
            type: "result",
            key,
            text: closing(str(p.text)),
            isError: p.isError === true,
            ...(typeof p.durationMs === "number" ? { durationMs: p.durationMs } : {}),
            ...tokensOf(turn),
          });
          break;
        }
        default:
          // `system`, `prompt` (tool results echoed back) and `other` carry nothing the user reads.
          break;
      }
    }
    if (turn.status === "running") items.push({ type: "working", key: `working-${turn.id}` });
    else if (!hasResult && turn.resultText) {
      items.push({ type: "result", key: `result-${turn.id}`, text: closing(turn.resultText), isError: turn.status === "failed", ...tokensOf(turn) });
    }
  }
  return items;
}

function tokensOf(turn: Turn): { inputTokens?: number; outputTokens?: number } {
  return {
    ...(turn.inputTokens !== undefined ? { inputTokens: turn.inputTokens } : {}),
    ...(turn.outputTokens !== undefined ? { outputTokens: turn.outputTokens } : {}),
  };
}

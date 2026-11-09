import type { AgentEventRecord } from "../ports/run-store.js";
import type { LiveLine } from "./types.js";

/** An agent timeline entry, optionally with the database id it was read with. */
export type TimelineEntry = AgentEventRecord & { id?: number };

const MAX_CHARS = 160;
/** Arguments worth showing next to a tool name, most telling first. */
const ARGUMENT_HINTS = ["path", "file_path", "command", "pattern", "query", "glob", "url"];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_CHARS ? `${flat.slice(0, MAX_CHARS - 1)}…` : flat;
}

const textOf = (payload: Record<string, unknown>, key = "text"): string =>
  typeof payload[key] === "string" ? clip(payload[key] as string) : "";

function toolName(payload: Record<string, unknown>): string {
  const tool = typeof payload.tool === "string" ? payload.tool : "tool";
  return tool.replace(/ToolCall$/, "") || tool;
}

/** One short line saying what an agent timeline entry is. Never empty. */
export function describeEntry(entry: Pick<TimelineEntry, "kind" | "payload">): string {
  const payload = isRecord(entry.payload) ? entry.payload : {};
  switch (entry.kind) {
    case "tool_started": {
      const args = isRecord(payload.args) ? payload.args : {};
      const hint = ARGUMENT_HINTS.map((k) => args[k]).find((v): v is string => typeof v === "string" && v !== "");
      return hint ? `${toolName(payload)}: ${clip(hint)}` : toolName(payload);
    }
    case "tool_completed":
      return `${toolName(payload)}: done`;
    case "system":
      return "session started";
    case "result":
      return textOf(payload) || "finished";
    case "other":
      return textOf(payload, "type") || "event";
    default:
      return textOf(payload) || entry.kind;
  }
}

/** The newest entry of an attempt, as the line the Cursor block shows. Entries are in database order. */
export function liveLineOf(entries: readonly TimelineEntry[], taskId: string, attempt: number): LiveLine | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.taskId !== taskId || entry.attempt !== attempt) continue;
    return {
      source: entry.agent ?? "cursor",
      kind: entry.kind,
      text: describeEntry(entry),
      ts: entry.ts,
      ...(entry.id !== undefined ? { eventId: entry.id } : {}),
    };
  }
  return undefined;
}

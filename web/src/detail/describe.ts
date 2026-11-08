import type { AttemptView } from "@board";
import type { AttemptNotes, TimelineEntry } from "./types";

const MAX_TEXT = 600;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function asText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

export function clip(text: string, max = MAX_TEXT): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export interface EntryView {
  /** Short label of what happened: `Thinking`, `Message`, `Tool call`... */
  label: string;
  text: string;
  /** Tool calls and their results are code-like and render in the mono face. */
  mono: boolean;
  error: boolean;
}

/** Turns one normalized timeline entry into text to show. Everything stays a string: agent output is never markup. */
export function describeEntry(entry: Pick<TimelineEntry, "kind" | "payload">): EntryView {
  const p = isRecord(entry.payload) ? entry.payload : {};
  const error = p.isError === true;
  switch (entry.kind) {
    case "thinking":
      return { label: "Thinking", text: clip(asText(p.text)), mono: false, error };
    case "message":
      return { label: "Message", text: clip(asText(p.text)), mono: false, error };
    case "prompt":
      return { label: "Prompt", text: clip(asText(p.text)), mono: false, error };
    case "result":
      return { label: error ? "Result (error)" : "Result", text: clip(asText(p.text)), mono: false, error };
    case "tool_started":
      return { label: `Tool: ${asText(p.tool) || "unknown"}`, text: clip(asText(p.args)), mono: true, error };
    case "tool_completed":
      return { label: `Tool done: ${asText(p.tool) || "unknown"}`, text: clip(asText(p.result)), mono: true, error };
    case "system":
      return { label: "Session", text: [p.model, p.permissionMode].map(asText).filter((s) => s !== "").join(" · "), mono: false, error };
    default:
      return { label: entry.kind, text: clip([p.type, p.subtype].map(asText).filter((s) => s !== "").join(" · ")), mono: false, error };
  }
}

/** The last `lines` lines of a text, with a marker when something was cut. */
export function tail(text: string, lines = 12): string {
  const all = text.replace(/\n+$/, "").split("\n");
  return all.length <= lines ? all.join("\n") : `…\n${all.slice(-lines).join("\n")}`;
}

export interface Verdict {
  label: string;
  ok: boolean;
  detail?: string;
}

/** What Knit decided about one attempt: its checks, the scope of the changes and the commit history. */
export function verdictsOf(attempt: AttemptView, notes: AttemptNotes): Verdict[] {
  if (attempt.status === "running" || attempt.status === "verifying" || attempt.status === "interrupted") return [];
  if (attempt.setup) {
    return [attempt.failedCheck === undefined ? { label: "Setup command", ok: true } : { label: "Setup command", ok: false, detail: attempt.failedCheck }];
  }
  const verdicts: Verdict[] = [];
  verdicts.push(attempt.failedCheck === undefined ? { label: "Checks", ok: true } : { label: "Checks", ok: false, detail: attempt.failedCheck });
  verdicts.push(attempt.scopeOk === false ? { label: "Scope", ok: false, detail: "Files outside the allowed list were changed" } : { label: "Scope", ok: true });
  verdicts.push(notes.gitProblems.length > 0 ? { label: "Git", ok: false, detail: notes.gitProblems.join("; ") } : { label: "Git", ok: true });
  return verdicts;
}

/** What Knit told the agent in the next attempt, from the problems of the one before. Empty when it passed or nothing was recorded. */
export function retryFeedback(previous: AttemptView, notes: AttemptNotes): string[] {
  if (previous.status !== "failed" || previous.setup) return [];
  return verdictsOf(previous, notes)
    .filter((v) => !v.ok)
    .map((v) => (v.detail === undefined ? v.label : `${v.label}: ${v.detail}`));
}

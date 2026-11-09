import type { SessionDetail, SessionEvent, SessionListEntry } from "../sessions/types";
import { buildTimeline, type TimelineItem } from "../sessions/timeline";
import type { SessionGlimpse } from "./pipeline";

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

function lineOf(item: TimelineItem): string | undefined {
  switch (item.type) {
    case "prompt":
      return `You: ${oneLine(item.text)}`;
    case "message":
      return oneLine(item.text);
    case "tool":
      return `${item.tool}${item.args === undefined ? "" : ` ${oneLine(item.args)}`}`;
    case "result":
      return `${item.isError ? "Failed: " : "Done: "}${oneLine(item.text)}`;
    case "thinking":
      return "Thinking";
    case "working":
      return undefined;
  }
}

/** The session the page shows without being asked: the one touched last. */
export function latestSession(entries: SessionListEntry[]): SessionListEntry | undefined {
  return entries.reduce<SessionListEntry | undefined>((best, e) => (best === undefined || e.session.updatedAt > best.session.updatedAt ? e : best), undefined);
}

const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);

/** A running subagent's name: the description it was given, else its type, else the tool name. */
function agentName(item: Extract<TimelineItem, { type: "tool" }>): string {
  try {
    const args = JSON.parse(item.args ?? "") as Record<string, unknown>;
    for (const key of ["description", "subagent_type"]) if (typeof args[key] === "string" && args[key] !== "") return oneLine(args[key]);
  } catch {
    // Arguments that are not JSON leave the tool name.
  }
  return item.tool;
}

/** A session reduced to what a block and the plan hop show: its state, last prompt and last timeline entries. */
export function glimpseOf(detail: SessionDetail, events: SessionEvent[]): SessionGlimpse {
  const items = buildTimeline(detail.turns, events);
  const lastPrompt = detail.turns[detail.turns.length - 1]?.prompt;
  const lines = items.map(lineOf).filter((l): l is string => l !== undefined && l !== "").slice(-3);
  const model = detail.meta.model ?? [...detail.turns].reverse().find((t) => t.profile?.model)?.profile?.model;
  const finished = [...detail.turns].reverse().find((t) => t.inputTokens !== undefined);
  const agents = items.filter((i): i is Extract<TimelineItem, { type: "tool" }> => i.type === "tool" && !i.done && SUBAGENT_TOOLS.has(i.tool)).map(agentName);
  return {
    status: detail.session.status,
    title: detail.session.title,
    ...(lastPrompt === undefined ? {} : { lastPrompt: oneLine(lastPrompt) }),
    lines,
    ...(model === undefined ? {} : { model }),
    ...(finished?.inputTokens === undefined ? {} : { contextTokens: finished.inputTokens }),
    turns: detail.turns.length,
    agents,
    planUsage: detail.meta.planUsage.map((w) => ({ name: w.name, utilization: w.utilization })),
  };
}

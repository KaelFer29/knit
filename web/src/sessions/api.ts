import { apiGet, apiPost } from "../api/client";
import type { AgentView, PlanUsageReading, Profile, SessionDetail, SessionEvent, SessionListEntry } from "./types";

const EVENTS_PAGE = 2000;

export interface AgentList {
  agents: AgentView[];
  /** Where `knit ui` was launched: the default directory of a new session. Absent when the server has no sessions. */
  cwd?: string;
}

export async function fetchAgentList(): Promise<AgentList> {
  return apiGet<AgentList>("/api/agents");
}

export async function fetchAgents(): Promise<AgentView[]> {
  return (await fetchAgentList()).agents;
}

export async function fetchModels(agent: string): Promise<string[]> {
  return (await apiGet<{ models: string[] }>(`/api/agents/${encodeURIComponent(agent)}/models`)).models;
}

export async function fetchSessions(): Promise<SessionListEntry[]> {
  return (await apiGet<{ sessions: SessionListEntry[] }>("/api/sessions")).sessions;
}

export function fetchSession(id: string): Promise<SessionDetail> {
  return apiGet<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`);
}

/** Every event after `after`, following the server's page size so a long session is read completely. */
export async function fetchEventsAfter(id: string, after: number): Promise<SessionEvent[]> {
  const out: SessionEvent[] = [];
  let cursor = after;
  for (;;) {
    const page = await apiGet<{ events: SessionEvent[]; lastEventId: number }>(`/api/sessions/${encodeURIComponent(id)}/events?after=${cursor}`);
    out.push(...page.events);
    if (page.events.length < EVENTS_PAGE) return out;
    cursor = page.lastEventId;
  }
}

export async function startSession(request: { agent: string; cwd: string; prompt: string; profile: Profile }): Promise<string> {
  return (await apiPost<{ sessionId: string }>("/api/sessions", request)).sessionId;
}

export async function sendTurn(sessionId: string, prompt: string, profile: Profile): Promise<void> {
  await apiPost(`/api/sessions/${encodeURIComponent(sessionId)}/turns`, { prompt, profile });
}

/** The person's plan windows now, read by the server from the agent's own usage command (cached a few seconds). */
export function fetchPlanUsage(agent: string): Promise<PlanUsageReading> {
  return apiGet<PlanUsageReading>(`/api/agents/${encodeURIComponent(agent)}/usage`);
}

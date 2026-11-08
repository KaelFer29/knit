/**
 * Shapes of the sessions API (see `docs/web-interface.md#sessions`). `web/` cannot import from `src/` at runtime, so
 * the few fields the page reads are described here.
 */

export interface AgentCapabilities {
  resume: boolean;
  chooseModel: boolean;
  commandList: boolean;
  visibleReasoning: boolean;
  planUsage: boolean;
}

export type ProfileField = "model" | "effort" | "permissionMode";

/** An agent as `GET /api/agents` describes it. The page renders from this, never from the agent's name. */
export interface AgentView {
  id: string;
  label: string;
  capabilities: AgentCapabilities;
  profileFields: ProfileField[];
}

export type Profile = Partial<Record<ProfileField, string>>;

export interface Session {
  id: string;
  agent: string;
  agentSessionId?: string;
  title: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  status: "idle" | "running";
}

export interface SessionListEntry {
  session: Session;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
}

export interface Turn {
  id: number;
  sessionId: string;
  seq: number;
  prompt: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "passed" | "failed";
  resultText?: string;
  inputTokens?: number;
  outputTokens?: number;
  profile?: Profile;
}

export interface PlanUsage {
  name: string;
  /** 0 to 1. */
  utilization: number;
  /** Unix seconds. */
  resetsAt?: number;
}

export interface SessionMeta {
  commands: string[];
  planUsage: PlanUsage[];
  model?: string;
}

export interface SessionDetail {
  session: Session;
  turns: Turn[];
  meta: SessionMeta;
  lastEventId: number;
  continueCommand?: string;
}

export interface SessionEvent {
  id: number;
  turnId: number;
  ts: string;
  kind: string;
  payload?: unknown;
  agent: string;
}

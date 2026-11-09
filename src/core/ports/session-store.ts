/** Port: persistence of chat sessions, their turns and each turn's timeline, for any agent. */
import type { AgentProfile, AgentRunMeta } from "./agent-runner.js";

/** `running` while a turn is in flight, `idle` otherwise. */
export type SessionStatus = "idle" | "running";
export type TurnStatus = "running" | "passed" | "failed";

export interface SessionRecord {
  /** Knit's own session id. */
  id: string;
  /** Agent that owns the conversation, for example `claude`. */
  agent: string;
  /** The agent's own session id; known once its first turn reported one. */
  agentSessionId?: string;
  title: string;
  /** Directory the agent runs in; every turn of the session uses it. */
  cwd: string;
  createdAt: string;
  /** Last time a turn started or finished. */
  updatedAt: string;
  status: SessionStatus;
}

export interface NewSession {
  id: string;
  agent: string;
  title: string;
  cwd: string;
  createdAt: string;
}

export interface TurnRecord {
  /** Unique across sessions; the timeline entries of the turn point at it. */
  id: number;
  sessionId: string;
  /** 1-based position of the turn inside its session. */
  seq: number;
  prompt: string;
  startedAt: string;
  finishedAt?: string;
  status: TurnStatus;
  resultText?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Absent when the process left no exit code (killed, timed out). */
  exitCode?: number;
  /** Per-turn knobs the user picked (model, effort, permission mode). */
  profile?: AgentProfile;
  /** Command list and plan usage the agent reported during the turn. */
  meta?: AgentRunMeta;
  /** Process executing the turn; cleared when the turn ends. */
  pid?: number;
}

export interface NewTurn {
  sessionId: string;
  prompt: string;
  startedAt: string;
  profile?: AgentProfile;
  pid?: number;
}

export interface TurnOutcome {
  status: "passed" | "failed";
  finishedAt: string;
  resultText?: string;
  inputTokens?: number;
  outputTokens?: number;
  exitCode?: number | null;
  meta?: AgentRunMeta;
}

/** One entry of a turn's normalized timeline, with the same shape as a run's `AgentEventRecord`. */
export interface SessionEventRecord {
  sessionId: string;
  turnId: number;
  ts: string;
  kind: string;
  payload?: unknown;
  /** Agent that produced the entry. */
  agent: string;
}

export interface StoredSessionEvent extends SessionEventRecord {
  id: number;
}

export interface SessionEventFilter {
  /** Only events with a greater id: lets a poller resume where it stopped. */
  afterId?: number;
  turnId?: number;
  limit?: number;
}

export interface SessionStore {
  createSession(session: NewSession): void;
  getSession(id: string): SessionRecord | undefined;
  /** Remembers the agent's own id for the session so the next turn can resume it. */
  setAgentSessionId(id: string, agentSessionId: string, updatedAt: string): void;
  /** Most recently active first (last turn start or finish). */
  listSessions(): SessionRecord[];
  /** Records a running turn with the next sequence number of its session and marks the session `running`. */
  startTurn(turn: NewTurn): TurnRecord;
  /** Ends a turn: stores its outcome, clears its pid and marks the session `idle`. */
  finishTurn(turnId: number, outcome: TurnOutcome): void;
  recordEvent(event: SessionEventRecord): void;
  /** Turns of a session, oldest first. */
  listTurns(sessionId: string): TurnRecord[];
  /** Timeline of a session, oldest first. */
  getEvents(sessionId: string, filter?: SessionEventFilter): StoredSessionEvent[];
}

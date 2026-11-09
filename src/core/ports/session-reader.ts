import type { SessionRecord, SessionEventFilter, StoredSessionEvent, TurnRecord } from "./session-store.js";

/**
 * Port: read side of the chat sessions, used by the web interface.
 *
 * It never writes. Sessions are written by `knit chat` processes only; the server reads them through this port. A
 * database without the session tables (older schema) reads as having no sessions.
 */

/** A session as the list shows it: the record plus what its turns add up to. */
export interface SessionListItem {
  session: SessionRecord;
  turnCount: number;
  /** Sum over every turn of the session; 0 when the agent reported none. */
  inputTokens: number;
  outputTokens: number;
}

export interface SessionReader {
  /** Most recently active first. */
  listSessions(): SessionListItem[];
  getSession(id: string): SessionRecord | undefined;
  /** Turns of a session, oldest first. */
  listTurns(sessionId: string): TurnRecord[];
  /** Timeline entries of a session with `id > filter.afterId`, oldest first. */
  getEvents(sessionId: string, filter?: SessionEventFilter): StoredSessionEvent[];
  close(): void;
}

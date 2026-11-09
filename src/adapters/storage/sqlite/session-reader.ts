import Database from "better-sqlite3";
import type { SessionListItem, SessionReader } from "../../../core/ports/session-reader.js";
import type { SessionEventFilter, SessionRecord, StoredSessionEvent, TurnRecord } from "../../../core/ports/session-store.js";
import { compact, type Row } from "./run-store.js";

/** A JSON column that is not valid JSON is shown as absent instead of failing the whole read. */
function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function toSession(r: Row): SessionRecord {
  return compact<SessionRecord>({
    id: r.id,
    agent: r.agent,
    agentSessionId: r.agent_session_id,
    title: r.title,
    cwd: r.cwd,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    status: r.status,
  });
}

function toTurn(r: Row): TurnRecord {
  return compact<TurnRecord>({
    id: r.id,
    sessionId: r.session_id,
    seq: r.seq,
    prompt: r.prompt,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    resultText: r.result_text,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    exitCode: r.exit_code,
    profile: parseJson(r.profile),
    meta: parseJson(r.meta),
    pid: r.pid,
  });
}

/**
 * SessionReader over a read-only SQLite connection. It never writes, never migrates and never touches `user_version`.
 * A database from before the session tables simply has no sessions.
 */
export class SqliteSessionReader implements SessionReader {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path, { readonly: true, fileMustExist: true });
  }

  close(): void {
    this.db.close();
  }

  private hasSessions(): boolean {
    return this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions'`).get() !== undefined;
  }

  listSessions(): SessionListItem[] {
    return this.db
      .transaction((): SessionListItem[] => {
        if (!this.hasSessions()) return [];
        const rows = this.db.prepare(`SELECT * FROM sessions ORDER BY updated_at DESC, rowid DESC`).all() as Row[];
        const sums = new Map<string, { n: number; input: number; output: number }>();
        const sumRows = this.db
          .prepare(
            `SELECT session_id, COUNT(*) AS n, COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output
             FROM turns GROUP BY session_id`,
          )
          .all() as { session_id: string; n: number; input: number; output: number }[];
        for (const s of sumRows) sums.set(s.session_id, { n: s.n, input: s.input, output: s.output });
        return rows.map((row) => {
          const session = toSession(row);
          const s = sums.get(session.id);
          return { session, turnCount: s?.n ?? 0, inputTokens: s?.input ?? 0, outputTokens: s?.output ?? 0 };
        });
      })
      .deferred();
  }

  getSession(id: string): SessionRecord | undefined {
    if (!this.hasSessions()) return undefined;
    const row = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Row | undefined;
    return row ? toSession(row) : undefined;
  }

  listTurns(sessionId: string): TurnRecord[] {
    if (!this.hasSessions()) return [];
    const rows = this.db.prepare(`SELECT * FROM turns WHERE session_id = ? ORDER BY seq`).all(sessionId) as Row[];
    return rows.map(toTurn);
  }

  getEvents(sessionId: string, filter: SessionEventFilter = {}): StoredSessionEvent[] {
    if (!this.hasSessions()) return [];
    const where = ["session_id = @sessionId", "id > @afterId", ...(filter.turnId !== undefined ? ["turn_id = @turnId"] : [])];
    const params: Record<string, unknown> = { sessionId, afterId: filter.afterId ?? 0, limit: filter.limit ?? -1 };
    if (filter.turnId !== undefined) params.turnId = filter.turnId;
    const rows = this.db.prepare(`SELECT * FROM session_events WHERE ${where.join(" AND ")} ORDER BY id LIMIT @limit`).all(params) as Row[];
    return rows.map((e) =>
      compact<StoredSessionEvent>({
        id: e.id,
        sessionId: e.session_id,
        turnId: e.turn_id,
        ts: e.ts,
        kind: e.kind,
        payload: parseJson(e.payload),
        agent: e.agent,
      }),
    );
  }
}

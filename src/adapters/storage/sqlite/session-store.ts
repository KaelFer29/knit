import type Database from "better-sqlite3";
import type {
  NewSession,
  NewTurn,
  SessionEventFilter,
  SessionEventRecord,
  SessionRecord,
  SessionStore,
  StoredSessionEvent,
  TurnOutcome,
  TurnRecord,
} from "../../../core/ports/session-store.js";
import { compact, type Row } from "./run-store.js";
import { openDatabase } from "./schema.js";

/** A JSON column that is not valid JSON is shown as absent instead of failing the whole read. */
function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

const toJson = (value: unknown): string | null => (value === undefined ? null : JSON.stringify(value));

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

/** SessionStore over the same SQLite file as the run store; both create and upgrade the schema the same way. */
export class SqliteSessionStore implements SessionStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = openDatabase(path);
  }

  close(): void {
    this.db.close();
  }

  createSession(s: NewSession): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, agent, title, cwd, created_at, updated_at, status)
         VALUES (@id, @agent, @title, @cwd, @createdAt, @createdAt, 'idle')`,
      )
      .run(s);
  }

  getSession(id: string): SessionRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Row | undefined;
    return row ? toSession(row) : undefined;
  }

  setAgentSessionId(id: string, agentSessionId: string, updatedAt: string): void {
    this.db.prepare(`UPDATE sessions SET agent_session_id = ?, updated_at = ? WHERE id = ?`).run(agentSessionId, updatedAt, id);
  }

  listSessions(): SessionRecord[] {
    const rows = this.db.prepare(`SELECT * FROM sessions ORDER BY updated_at DESC, rowid DESC`).all() as Row[];
    return rows.map(toSession);
  }

  /** The sequence number is read and used inside one write transaction, so two processes cannot take the same one. */
  startTurn(t: NewTurn): TurnRecord {
    return this.db.transaction((): TurnRecord => {
      const last = this.db.prepare(`SELECT MAX(seq) AS last FROM turns WHERE session_id = ?`).get(t.sessionId) as { last: number | null };
      const info = this.db
        .prepare(
          `INSERT INTO turns (session_id, seq, prompt, started_at, status, profile, pid)
           VALUES (@sessionId, @seq, @prompt, @startedAt, 'running', @profile, @pid)`,
        )
        .run({ sessionId: t.sessionId, seq: (last.last ?? 0) + 1, prompt: t.prompt, startedAt: t.startedAt, profile: toJson(t.profile), pid: t.pid ?? null });
      this.db.prepare(`UPDATE sessions SET status = 'running', updated_at = ? WHERE id = ?`).run(t.startedAt, t.sessionId);
      return toTurn(this.db.prepare(`SELECT * FROM turns WHERE id = ?`).get(info.lastInsertRowid) as Row);
    }).immediate();
  }

  finishTurn(turnId: number, o: TurnOutcome): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE turns SET status = @status, finished_at = @finishedAt, result_text = @resultText,
             input_tokens = @inputTokens, output_tokens = @outputTokens, exit_code = @exitCode, meta = @meta, pid = NULL
           WHERE id = @id`,
        )
        .run({
          id: turnId,
          status: o.status,
          finishedAt: o.finishedAt,
          resultText: o.resultText ?? null,
          inputTokens: o.inputTokens ?? null,
          outputTokens: o.outputTokens ?? null,
          exitCode: o.exitCode ?? null,
          meta: toJson(o.meta),
        });
      this.db
        .prepare(`UPDATE sessions SET status = 'idle', updated_at = ? WHERE id = (SELECT session_id FROM turns WHERE id = ?)`)
        .run(o.finishedAt, turnId);
    }).immediate();
  }

  recordEvent(e: SessionEventRecord): void {
    this.db
      .prepare(
        `INSERT INTO session_events (session_id, turn_id, ts, kind, payload, agent)
         VALUES (@sessionId, @turnId, @ts, @kind, @payload, @agent)`,
      )
      .run({ sessionId: e.sessionId, turnId: e.turnId, ts: e.ts, kind: e.kind, payload: toJson(e.payload), agent: e.agent });
  }

  listTurns(sessionId: string): TurnRecord[] {
    const rows = this.db.prepare(`SELECT * FROM turns WHERE session_id = ? ORDER BY seq`).all(sessionId) as Row[];
    return rows.map(toTurn);
  }

  /** Timeline of a session, oldest first. `afterId` makes it usable for live polling. */
  getEvents(sessionId: string, filter: SessionEventFilter = {}): StoredSessionEvent[] {
    const where = ["session_id = @sessionId", "id > @afterId", ...(filter.turnId !== undefined ? ["turn_id = @turnId"] : [])];
    const rows = this.db
      .prepare(`SELECT * FROM session_events WHERE ${where.join(" AND ")} ORDER BY id LIMIT @limit`)
      .all({ sessionId, afterId: filter.afterId ?? 0, turnId: filter.turnId ?? null, limit: filter.limit ?? -1 }) as Row[];
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

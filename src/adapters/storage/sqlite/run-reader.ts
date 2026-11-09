import Database from "better-sqlite3";
import type { AttemptRecord } from "../../../core/ports/run-store.js";
import type {
  AgentEventFilter,
  RunListItem,
  RunReader,
  RunSnapshot,
  StoredAgentEvent,
  StoredRun,
  StoredEvent,
  TaskCounts,
} from "../../../core/ports/run-reader.js";
import { compact, toRun, toTask, type Row } from "./run-store.js";

/** The agent that wrote timeline rows from before schema 4, which had no `agent` column. */
const LEGACY_AGENT = "cursor";

/** A payload column that is not valid JSON is shown as absent instead of failing the whole read. */
function parsePayload(value: unknown): unknown {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/**
 * RunReader over a read-only SQLite connection.
 *
 * It never writes, never migrates and never touches `user_version`: columns added by newer schemas are simply absent
 * on older databases, and the mapped records leave those fields out. WAL lets it read while another process writes;
 * each public call reads from one consistent snapshot.
 */
export class SqliteRunReader implements RunReader {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path, { readonly: true, fileMustExist: true });
  }

  close(): void {
    this.db.close();
  }

  listRuns(): RunListItem[] {
    return this.db.transaction((): RunListItem[] => {
      const runs = this.db.prepare(`SELECT * FROM runs ORDER BY started_at DESC, rowid DESC`).all() as Row[];
      const counts = new Map<string, TaskCounts>();
      const taskRows = this.db
        .prepare(`SELECT run_id, status, COUNT(*) AS n FROM tasks GROUP BY run_id, status`)
        .all() as { run_id: string; status: string; n: number }[];
      for (const row of taskRows) {
        const c = counts.get(row.run_id) ?? { total: 0, pending: 0, running: 0, passed: 0, failed: 0 };
        c.total += row.n;
        if (row.status === "pending" || row.status === "running" || row.status === "passed" || row.status === "failed") {
          c[row.status] += row.n;
        }
        counts.set(row.run_id, c);
      }
      const tokens = new Map<string, { input: number; output: number }>();
      const tokenRows = this.db
        .prepare(
          `SELECT run_id, COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output
           FROM attempts GROUP BY run_id`,
        )
        .all() as { run_id: string; input: number; output: number }[];
      for (const row of tokenRows) tokens.set(row.run_id, { input: row.input, output: row.output });

      return runs.map((row) => {
        const run = toRun(row);
        const t = tokens.get(run.id);
        return {
          run,
          taskCounts: counts.get(run.id) ?? { total: 0, pending: 0, running: 0, passed: 0, failed: 0 },
          inputTokens: t?.input ?? 0,
          outputTokens: t?.output ?? 0,
        };
      });
    }).deferred();
  }

  getRun(runId: string): StoredRun | undefined {
    const row = this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(runId) as Row | undefined;
    return row ? toRun(row) : undefined;
  }

  getRunSnapshot(runId: string): RunSnapshot | undefined {
    return this.db.transaction((): RunSnapshot | undefined => {
      const row = this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(runId) as Row | undefined;
      if (!row) return undefined;
      const tasks = (this.db.prepare(`SELECT * FROM tasks WHERE run_id = ? ORDER BY rowid`).all(runId) as Row[]).map(toTask);
      const attempts = (this.db.prepare(`SELECT * FROM attempts WHERE run_id = ? ORDER BY id`).all(runId) as Row[]).map(toAttempt);
      const events = this.getEventsAfter(runId, 0);
      const lastAgent = this.db
        .prepare(`SELECT COALESCE(MAX(id), 0) AS last FROM agent_events WHERE run_id = ?`)
        .get(runId) as { last: number };
      return {
        run: toRun(row),
        tasks,
        attempts,
        events,
        lastEventId: events.at(-1)?.id ?? 0,
        lastAgentEventId: lastAgent.last,
      };
    }).deferred();
  }

  getEventsAfter(runId: string, afterId: number, limit?: number): StoredEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE run_id = @runId AND id > @afterId ORDER BY id LIMIT @limit`)
      .all({ runId, afterId, limit: limit ?? -1 }) as Row[];
    return rows.map((e) =>
      compact<StoredEvent>({
        id: e.id,
        runId: e.run_id,
        taskId: e.task_id,
        attempt: e.attempt,
        ts: e.ts,
        type: e.type,
        payload: parsePayload(e.payload),
      }),
    );
  }

  getAgentEventsAfter(runId: string, afterId: number, filter: AgentEventFilter = {}): StoredAgentEvent[] {
    const where = [
      "run_id = @runId",
      "id > @afterId",
      ...(filter.taskId !== undefined ? ["task_id = @taskId"] : []),
      ...(filter.attempt !== undefined ? ["attempt = @attempt"] : []),
    ];
    const params: Record<string, unknown> = { runId, afterId, limit: filter.limit ?? -1 };
    if (filter.taskId !== undefined) params.taskId = filter.taskId;
    if (filter.attempt !== undefined) params.attempt = filter.attempt;
    const rows = this.db
      .prepare(`SELECT * FROM agent_events WHERE ${where.join(" AND ")} ORDER BY id LIMIT @limit`)
      .all(params) as Row[];
    return rows.map(toAgentEvent);
  }

  getLatestAgentEvents(runId: string, limit: number, filter: Omit<AgentEventFilter, "limit"> = {}): StoredAgentEvent[] {
    const where = [
      "run_id = @runId",
      ...(filter.taskId !== undefined ? ["task_id = @taskId"] : []),
      ...(filter.attempt !== undefined ? ["attempt = @attempt"] : []),
    ];
    const params: Record<string, unknown> = { runId, limit: Math.max(0, Math.floor(limit)) };
    if (filter.taskId !== undefined) params.taskId = filter.taskId;
    if (filter.attempt !== undefined) params.attempt = filter.attempt;
    const rows = this.db
      .prepare(`SELECT * FROM agent_events WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT @limit`)
      .all(params) as Row[];
    return rows.reverse().map(toAgentEvent);
  }
}

function toAgentEvent(e: Row): StoredAgentEvent {
  return compact<StoredAgentEvent>({
    id: e.id,
    runId: e.run_id,
    taskId: e.task_id,
    attempt: e.attempt,
    ts: e.ts,
    kind: e.kind,
    payload: parsePayload(e.payload),
    agent: e.agent ?? LEGACY_AGENT,
  });
}

function toAttempt(a: Row): AttemptRecord {
  return compact<AttemptRecord>({
    runId: a.run_id,
    taskId: a.task_id,
    attempt: a.attempt,
    startedAt: a.started_at,
    durationMs: a.duration_ms,
    exitCode: a.exit_code,
    isError: a.is_error === 1,
    inputTokens: a.input_tokens,
    outputTokens: a.output_tokens,
    scopeOk: a.scope_ok === 1,
    failedCheck: a.failed_check,
    status: a.status,
    sessionId: a.session_id,
    resultText: a.result_text,
  });
}

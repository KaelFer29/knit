import Database from "better-sqlite3";
import type {
  AgentEventRecord,
  AttemptRecord,
  EventRecord,
  RunRecord,
  RunStatus,
  RunStore,
  TaskRecord,
  TaskSpec,
} from "../../../core/ports/run-store.js";
import { openDatabase } from "./schema.js";

export interface StoredRun extends RunRecord {
  status: RunStatus;
  finishedAt?: string;
}

export interface StoredAgentEvent extends Omit<AgentEventRecord, "agent"> {
  id: number;
  agent: string;
}

export interface RunDetail {
  run: StoredRun;
  tasks: TaskRecord[];
  attempts: AttemptRecord[];
}

export type Row = Record<string, unknown>;

/** Drops null/undefined keys so optional fields stay absent on the returned objects. */
export function compact<T extends object>(obj: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined)) as T;
}

export class SqliteRunStore implements RunStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = openDatabase(path);
  }

  close(): void {
    this.db.close();
  }

  createRun(run: RunRecord): void {
    this.db
      .prepare(
        `INSERT INTO runs (id, plan_name, plan_path, repo, base, started_at, status, plan_text, pid)
         VALUES (@id, @planName, @planPath, @repo, @base, @startedAt, 'running', @planText, @pid)`,
      )
      .run({ planText: null, pid: null, ...run });
  }

  finishRun(id: string, status: RunStatus, finishedAt: string): void {
    this.db.prepare(`UPDATE runs SET status = ?, finished_at = ?, pid = NULL WHERE id = ?`).run(status, finishedAt, id);
  }

  reopenRun(id: string, pid?: number): void {
    this.db.prepare(`UPDATE runs SET status = 'running', finished_at = NULL, pid = ? WHERE id = ?`).run(pid ?? null, id);
  }

  upsertTask(t: TaskRecord): void {
    this.db
      .prepare(
        `INSERT INTO tasks (run_id, task_id, title, status, branch, worktree, commit_sha, pr_url, start_sha,
           goal, depends_on, position, specs)
         VALUES (@runId, @taskId, @title, @status, @branch, @worktree, @commitSha, @prUrl, @startSha,
           @goal, @dependsOn, @position, @specs)
         ON CONFLICT(run_id, task_id) DO UPDATE SET
           title = excluded.title,
           status = excluded.status,
           branch = COALESCE(excluded.branch, tasks.branch),
           worktree = COALESCE(excluded.worktree, tasks.worktree),
           commit_sha = COALESCE(excluded.commit_sha, tasks.commit_sha),
           pr_url = COALESCE(excluded.pr_url, tasks.pr_url),
           start_sha = COALESCE(excluded.start_sha, tasks.start_sha),
           goal = COALESCE(excluded.goal, tasks.goal),
           depends_on = COALESCE(excluded.depends_on, tasks.depends_on),
           position = COALESCE(excluded.position, tasks.position),
           specs = COALESCE(excluded.specs, tasks.specs)`,
      )
      .run({
        branch: null, worktree: null, commitSha: null, prUrl: null, startSha: null,
        goal: null, dependsOn: null, position: null,
        ...t,
        specs: t.specs === undefined ? null : JSON.stringify(t.specs),
      });
  }

  getTasks(runId: string): TaskRecord[] {
    const rows = this.db.prepare(`SELECT * FROM tasks WHERE run_id = ? ORDER BY rowid`).all(runId) as Row[];
    return rows.map(toTask);
  }

  nextAttempt(runId: string, taskId: string): number {
    const row = this.db
      .prepare(`SELECT MAX(attempt) AS last FROM attempts WHERE run_id = ? AND task_id = ?`)
      .get(runId, taskId) as { last: number | null };
    return (row.last ?? 0) + 1;
  }

  recordAttempt(a: AttemptRecord): void {
    this.db
      .prepare(
        `INSERT INTO attempts (run_id, task_id, attempt, started_at, duration_ms, exit_code, is_error,
           input_tokens, output_tokens, scope_ok, failed_check, status, session_id, result_text)
         VALUES (@runId, @taskId, @attempt, @startedAt, @durationMs, @exitCode, @isError,
           @inputTokens, @outputTokens, @scopeOk, @failedCheck, @status, @sessionId, @resultText)`,
      )
      .run({
        inputTokens: null,
        outputTokens: null,
        failedCheck: null,
        sessionId: null,
        resultText: null,
        ...a,
        isError: a.isError ? 1 : 0,
        scopeOk: a.scopeOk ? 1 : 0,
      });
  }

  recordEvent(e: EventRecord): void {
    this.db
      .prepare(
        `INSERT INTO events (run_id, task_id, attempt, ts, type, payload)
         VALUES (@runId, @taskId, @attempt, @ts, @type, @payload)`,
      )
      .run({
        taskId: null,
        attempt: null,
        ...e,
        payload: e.payload === undefined ? null : JSON.stringify(e.payload),
      });
  }

  recordAgentEvent(e: AgentEventRecord): void {
    this.db
      .prepare(
        `INSERT INTO agent_events (run_id, task_id, attempt, ts, kind, payload, agent)
         VALUES (@runId, @taskId, @attempt, @ts, @kind, @payload, COALESCE(@agent, 'cursor'))`,
      )
      .run({
        taskId: null,
        attempt: null,
        agent: null,
        ...e,
        payload: e.payload === undefined ? null : JSON.stringify(e.payload),
      });
  }

  /** Agent timeline of a run, oldest first. `afterId` makes it usable for live polling. */
  getAgentEvents(runId: string, filter: { afterId?: number; taskId?: string; limit?: number } = {}): StoredAgentEvent[] {
    const where = ["run_id = @runId", "id > @afterId", ...(filter.taskId ? ["task_id = @taskId"] : [])];
    const rows = this.db
      .prepare(`SELECT * FROM agent_events WHERE ${where.join(" AND ")} ORDER BY id LIMIT @limit`)
      .all({ runId, afterId: filter.afterId ?? 0, taskId: filter.taskId ?? null, limit: filter.limit ?? -1 }) as Row[];
    return rows.map((e) =>
      compact<StoredAgentEvent>({
        id: e.id,
        runId: e.run_id,
        taskId: e.task_id,
        attempt: e.attempt,
        ts: e.ts,
        kind: e.kind,
        payload: typeof e.payload === "string" ? JSON.parse(e.payload) : undefined,
        agent: e.agent,
      }),
    );
  }

  listRuns(): StoredRun[] {
    const rows = this.db.prepare(`SELECT * FROM runs ORDER BY started_at DESC, rowid DESC`).all() as Row[];
    return rows.map(toRun);
  }

  getRun(id: string): RunDetail | undefined {
    const row = this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as Row | undefined;
    if (!row) return undefined;
    const tasks = this.getTasks(id);
    const attempts = (this.db.prepare(`SELECT * FROM attempts WHERE run_id = ? ORDER BY id`).all(id) as Row[]).map((a) =>
      compact<AttemptRecord>({
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
      }),
    );
    return { run: toRun(row), tasks, attempts };
  }

  getEvents(runId: string): EventRecord[] {
    const rows = this.db.prepare(`SELECT * FROM events WHERE run_id = ? ORDER BY id`).all(runId) as Row[];
    return rows.map((e) =>
      compact<EventRecord>({
        runId: e.run_id,
        taskId: e.task_id,
        attempt: e.attempt,
        ts: e.ts,
        type: e.type,
        payload: typeof e.payload === "string" ? JSON.parse(e.payload) : undefined,
      }),
    );
  }
}

export function toTask(t: Row): TaskRecord {
  return compact<TaskRecord>({
    runId: t.run_id,
    taskId: t.task_id,
    title: t.title,
    status: t.status,
    branch: t.branch,
    worktree: t.worktree,
    startSha: t.start_sha,
    commitSha: t.commit_sha,
    prUrl: t.pr_url,
    goal: t.goal,
    dependsOn: t.depends_on,
    position: t.position,
    specs: typeof t.specs === "string" ? (JSON.parse(t.specs) as TaskSpec[]) : undefined,
  });
}

export function toRun(r: Row): StoredRun {
  return compact<StoredRun>({
    id: r.id,
    planName: r.plan_name,
    planPath: r.plan_path,
    repo: r.repo,
    base: r.base,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    planText: r.plan_text,
    pid: r.pid,
  });
}

import Database from "better-sqlite3";

/**
 * Schema and in-place migration shared by every SQLite store, so whichever opens the database first
 * produces the same final schema. This module imports nothing from the project on purpose: the
 * migration test compiles it alone and runs it in several processes at once.
 */
export const SCHEMA_VERSION = 5;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  plan_name TEXT NOT NULL,
  plan_path TEXT NOT NULL,
  repo TEXT NOT NULL,
  base TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  plan_text TEXT,
  pid INTEGER
);
CREATE TABLE IF NOT EXISTS tasks (
  run_id TEXT NOT NULL REFERENCES runs(id),
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  branch TEXT,
  worktree TEXT,
  commit_sha TEXT,
  pr_url TEXT,
  start_sha TEXT,
  goal TEXT,
  depends_on TEXT,
  position INTEGER,
  specs TEXT,
  PRIMARY KEY (run_id, task_id)
);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  task_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  exit_code INTEGER,
  is_error INTEGER NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  scope_ok INTEGER NOT NULL,
  failed_check TEXT,
  status TEXT NOT NULL,
  session_id TEXT,
  result_text TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  task_id TEXT,
  attempt INTEGER,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT
);
CREATE TABLE IF NOT EXISTS agent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  task_id TEXT,
  attempt INTEGER,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT,
  agent TEXT NOT NULL DEFAULT 'cursor'
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  agent_session_id TEXT,
  title TEXT NOT NULL,
  cwd TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  seq INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  result_text TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  exit_code INTEGER,
  profile TEXT,
  meta TEXT,
  pid INTEGER,
  UNIQUE (session_id, seq)
);
CREATE TABLE IF NOT EXISTS session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  turn_id INTEGER NOT NULL REFERENCES turns(id),
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT,
  agent TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_events_run ON agent_events(run_id, id);
CREATE INDEX IF NOT EXISTS idx_attempts_run ON attempts(run_id, task_id, attempt);
CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, id);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id, id);
CREATE INDEX IF NOT EXISTS idx_session_events_turn ON session_events(turn_id, id);
`;

/**
 * Columns that older databases lack, added in place. Listed in the order the schemas introduced them.
 * Tables new in a schema version need no entry: `CREATE TABLE IF NOT EXISTS` creates them whole.
 * Existing timeline rows are all Cursor's, hence the `agent` default.
 */
const COLUMNS_ADDED_LATER: Record<string, [name: string, definition: string][]> = {
  runs: [["plan_text", "TEXT"], ["pid", "INTEGER"]],
  tasks: [
    ["pr_url", "TEXT"], ["start_sha", "TEXT"],
    ["goal", "TEXT"], ["depends_on", "TEXT"], ["position", "INTEGER"], ["specs", "TEXT"],
  ],
  agent_events: [["agent", "TEXT NOT NULL DEFAULT 'cursor'"]],
};

/**
 * Switches a file database to WAL, which readers need to coexist with a writer. Changing the mode takes an exclusive
 * lock and fails at once with SQLITE_BUSY when another process is opening the same new database at that moment, so
 * the change is retried; a process that lost the race finds the mode already set.
 */
function enableWal(db: Database.Database): void {
  for (let attempt = 0; ; attempt++) {
    if (db.pragma("journal_mode", { simple: true }) === "wal") return;
    try {
      db.pragma("journal_mode = WAL");
      return;
    } catch (err) {
      if ((err as { code?: string }).code !== "SQLITE_BUSY" || attempt >= 50) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 + attempt * 5);
    }
  }
}

/**
 * Opens (and creates) the database and brings it to the current schema.
 *
 * The upgrade is idempotent: it checks the real tables and columns instead of trusting `user_version`, so an
 * interrupted upgrade can be repeated. It runs in one transaction that takes the write lock up front (`immediate`):
 * a deferred one reads first and then fails with SQLITE_BUSY when another process opens the same old database at the
 * same moment, and checking columns before the lock would let two processes both try to add them.
 */
export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  try {
    if (path !== ":memory:") enableWal(db);
    db.pragma("foreign_keys = ON");
    db.transaction(() => {
      db.exec(SCHEMA);
      for (const [table, columns] of Object.entries(COLUMNS_ADDED_LATER)) {
        const have = new Set((db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name));
        for (const [name, definition] of columns) {
          if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
        }
      }
      if ((db.pragma("user_version", { simple: true }) as number) < SCHEMA_VERSION) {
        db.pragma(`user_version = ${SCHEMA_VERSION}`);
      }
    }).immediate();
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

import type { IncomingMessage, ServerResponse } from "node:http";
import type { FileTree } from "../core/ports/file-tree.js";
import type { PlanDrafts } from "../core/ports/plan-drafts.js";
import type { RunReader } from "../core/ports/run-reader.js";
import type { TaskDiff } from "../core/ports/task-diff.js";
import type { AgentCapabilities } from "../core/ports/agent-runner.js";
import type { SessionReader } from "../core/ports/session-reader.js";

export type Method = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

/** What every route module receives. Later tasks extend it. */
export interface ServerDeps {
  reader: RunReader;
  /** Milliseconds between polls of the reader while a stream is open (default 500). */
  pollIntervalMs: number;
  /** Milliseconds between checks of the run's status while a stream is idle (default 2000). */
  statusIntervalMs: number;
  /** Milliseconds between SSE heartbeat comments (default 15000). */
  heartbeatMs: number;
  now: () => number;
  /** Run control (start, abort, resume, retry). Optional so a read-only server stays possible. */
  control?: ControlDeps;
  /** Read-only file explorer for the repository and the task worktrees. Without it the file routes answer 503. */
  files?: FileTree;
  /** Reads what a task changed from its worktree. Without it the diff route answers 503. */
  taskDiff?: TaskDiff;
  /** Read-only detection of the draft plans in a session's directory. Without it the plans route answers 503. */
  plans?: PlanDrafts;
}

export interface RouteContext {
  deps: ServerDeps;
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  /** Path parameters, already percent-decoded. */
  params: Record<string, string>;
}

export interface Route {
  method: Method;
  /** Path with `:name` segments, for example `/api/runs/:id`. */
  pattern: string;
  handler: (ctx: RouteContext) => void | Promise<void>;
}

/** A module contributes routes; `routes/index.ts` registers each one with a single line. */
export type RouteModule = (deps: ServerDeps) => Route[];

/** One child process the server asks the spawner to start. */
export interface SpawnRequest {
  /** Arguments of the Knit CLI, for example `["abort", "<run-id>", "--data-dir", "<dir>"]`. */
  args: string[];
  /** Working directory of the child (default: the server's). */
  cwd?: string;
  /** File the child's stdout and stderr are appended to. */
  logFile: string;
}

export interface SpawnedProcess {
  /** Undefined when the process could not be started. */
  pid: number | undefined;
  /** Resolves with the exit code (null when killed by a signal or never started) once the child is gone. */
  exited: Promise<number | null>;
}

/**
 * Starts a Knit CLI process, detached from the server (its own process group, outliving it, token not inherited).
 * The composition root provides it; the server never imports an adapter or spawns anything itself.
 */
export type Spawner = (request: SpawnRequest) => SpawnedProcess;

/** What the run control routes need. Absent when the server is started without control (they then answer 503). */
export interface ControlDeps {
  /** The data directory every spawned command is told to use (`--data-dir`). */
  dataDir: string;
  spawn: Spawner;
  /** How long to wait for a started or resumed run to show up in the database (default 10000). */
  registerTimeoutMs?: number;
  /** Chat sessions (list, turns, start a turn). Absent: the session routes answer empty lists or 503. */
  sessions?: SessionsDeps;
}

/** Per-turn knobs the composer may show for an agent. */
export type ProfileField = "model" | "effort" | "permissionMode";

/** What the server knows about one agent: declared by its adapter, wired by the composition root. */
export interface AgentInfo {
  id: string;
  label: string;
  capabilities: AgentCapabilities;
  /** The profile fields the agent accepts. */
  profileFields: ProfileField[];
  /** Model ids for the picker; resolves to an empty list when the agent cannot be asked. */
  listModels?: () => Promise<string[]>;
  /** The terminal command that continues the agent's own session (for example `claude --resume <id>`). */
  resumeCommand: (agentSessionId: string) => string;
}

/** What the session routes need. Writes happen only in the `knit chat` processes the control spawner starts. */
export interface SessionsDeps {
  reader: SessionReader;
  agents: AgentInfo[];
}

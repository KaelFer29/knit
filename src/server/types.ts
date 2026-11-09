import type { IncomingMessage, ServerResponse } from "node:http";
import type { RunReader } from "../core/ports/run-reader.js";

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
}

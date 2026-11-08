import type { IncomingMessage, ServerResponse } from "node:http";
import type { RunReader } from "../core/ports/run-reader.js";

export type Method = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

/** What every route module receives. Later tasks extend it (for example with a process manager). */
export interface ServerDeps {
  reader: RunReader;
  /** Milliseconds between polls of the reader while a stream is open (default 500). */
  pollIntervalMs: number;
  /** Milliseconds between checks of the run's status while a stream is idle (default 2000). */
  statusIntervalMs: number;
  /** Milliseconds between SSE heartbeat comments (default 15000). */
  heartbeatMs: number;
  now: () => number;
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

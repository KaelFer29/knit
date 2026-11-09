import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { FileTree } from "../core/ports/file-tree.js";
import type { PlanDrafts } from "../core/ports/plan-drafts.js";
import type { RunReader } from "../core/ports/run-reader.js";
import type { BranchInspector } from "../core/ports/branch-tools.js";
import type { TaskDiff } from "../core/ports/task-diff.js";
import type { FileActivity } from "../core/ports/file-activity.js";
import { BASE_HEADERS, HttpError, sendError } from "./http.js";
import { decodeSegments, Router } from "./router.js";
import { routeModules } from "./routes/index.js";
import { generateToken, guard, hostAllowed, queryTokenRedirect } from "./security.js";
import { defaultStaticDir, serveStatic } from "./static.js";
import type { ControlDeps, ServerDeps } from "./types.js";

/** The server only ever listens here. There is deliberately no option to change it. */
export const HOST = "127.0.0.1";

export interface ServerOptions {
  reader: RunReader;
  /** 0 picks a free port. */
  port: number;
  /** Built web app (default: `dist/web` next to the compiled server). */
  staticDir?: string;
  /** Launch token (default: 32 random bytes, hex). Tests may pass one. */
  token?: string;
  pollIntervalMs?: number;
  statusIntervalMs?: number;
  heartbeatMs?: number;
  now?: () => number;
  /** Run control (start, abort, resume, retry). Without it those routes answer 503. */
  control?: ControlDeps;
  /** File explorer. Without it the file routes answer 503. */
  files?: FileTree;
  /** Reads what a task changed from its worktree. Without it the diff route answers 503. */
  taskDiff?: TaskDiff;
  /** Reads the state of the branches the tasks created. Without it the branches route answers 503. */
  branches?: BranchInspector;
  /** Draft plan detection. Without it the plans route answers 503. */
  plans?: PlanDrafts;
  /** Reads the files a task worktree has changed. Without it the activity route leaves the worktree list out. */
  fileActivity?: FileActivity;
}

export interface RunningServer {
  port: number;
  token: string;
  /** The URL to open: it carries the token once, on the first page load. */
  url: string;
  close(): Promise<void>;
}

/** Thrown by `startServer` when the port is taken. */
export class PortInUseError extends Error {
  constructor(readonly port: number) {
    super(`Port ${port} is already in use`);
  }
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const token = options.token ?? generateToken();
  const deps: ServerDeps = {
    reader: options.reader,
    pollIntervalMs: options.pollIntervalMs ?? 500,
    statusIntervalMs: options.statusIntervalMs ?? 2000,
    heartbeatMs: options.heartbeatMs ?? 15_000,
    now: options.now ?? Date.now,
    ...(options.control ? { control: options.control } : {}),
    ...(options.files ? { files: options.files } : {}),
    ...(options.taskDiff ? { taskDiff: options.taskDiff } : {}),
    ...(options.branches ? { branches: options.branches } : {}),
    ...(options.plans ? { plans: options.plans } : {}),
    ...(options.fileActivity ? { fileActivity: options.fileActivity } : {}),
  };
  const router = new Router(routeModules.flatMap((mod) => mod(deps)));
  const staticDir = options.staticDir ?? defaultStaticDir();
  const security = { token, port: 0 };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!hostAllowed(req, security.port)) return sendError(res, 403, "Forbidden host");

    const target = req.url ?? "";
    let url: URL;
    try {
      if (!target.startsWith("/")) throw new Error("not an origin-form target");
      // Appended, not resolved: `//host/path` must stay a path and not turn into another host.
      url = new URL(`http://localhost${target}`);
    } catch {
      return sendError(res, 400, "Malformed request target");
    }

    // First page load: ?token= becomes a cookie and the URL is cleaned.
    const redirect = queryTokenRedirect(req, url, security);
    if (redirect === "invalid") return sendError(res, 401, "Missing or invalid token");
    if (redirect) {
      res.writeHead(302, {
        ...BASE_HEADERS,
        Location: redirect.location,
        "Set-Cookie": redirect.setCookie,
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }

    const verdict = guard(req, security);
    if (!verdict.ok) return sendError(res, verdict.status, verdict.message);

    const segments = decodeSegments(url.pathname);
    if (!segments) return sendError(res, 400, "Malformed path");

    const match = router.match(req.method ?? "", segments);
    if (match.kind === "found") {
      await match.route.handler({ deps, req, res, url, params: match.params });
      return;
    }
    if (match.kind === "method-not-allowed") {
      return sendError(res, 405, "Method not allowed", { Allow: [...new Set(match.allow)].join(", ") });
    }
    if (segments[0] === "api") throw new HttpError(404, "Not found");
    if (!serveStatic(staticDir, req, res, url.pathname)) {
      return sendError(res, 405, "Method not allowed", { Allow: "GET, HEAD" });
    }
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof HttpError) sendError(res, err.status, err.message);
      else sendError(res, 500, "Internal error");
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      reject(err.code === "EADDRINUSE" ? new PortInUseError(options.port) : err);
    });
    server.listen(options.port, HOST, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Server has no TCP address");
  security.port = address.port;

  return {
    port: address.port,
    token,
    url: `http://${HOST}:${address.port}/?token=${token}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

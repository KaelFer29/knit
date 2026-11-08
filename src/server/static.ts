import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_HEADERS, HttpError } from "./http.js";

/** `dist/web` next to the compiled server (`dist/server/static.js`). */
export const defaultStaticDir = (): string => fileURLToPath(new URL("../web", import.meta.url));

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const NOT_BUILT = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Knit</title></head>
<body>
<h1>Knit interface not built</h1>
<p>The server is running, but there is no built interface to serve yet.</p>
<p>Run <code>pnpm build</code> and restart <code>knit ui</code>.</p>
</body></html>
`;

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Maps a URL path to a file inside `root`, or undefined when there is none. Throws 400/403 for unsafe paths. */
function resolveFile(root: string, pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, "Malformed path");
  }
  if (decoded.includes("\0") || decoded.includes("\\")) throw new HttpError(400, "Malformed path");
  const target = resolve(root, `.${decoded}`);
  if (target !== root && !target.startsWith(root + sep)) throw new HttpError(403, "Forbidden");
  if (!isFile(target)) return undefined;
  // A symlink inside the folder must not lead out of it.
  const real = realpathSync(target);
  if (!real.startsWith(realpathSync(root) + sep)) throw new HttpError(403, "Forbidden");
  return real;
}

/**
 * Serves the built app from `dir` with SPA fallback to `index.html`. When `dir` does not exist it serves a small
 * "not built" page instead. Returns false when the request is not for a static file (not GET/HEAD).
 */
export function serveStatic(dir: string, req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const head = req.method === "HEAD";

  if (!existsSync(dir)) {
    res.writeHead(200, { ...BASE_HEADERS, "Content-Type": TYPES[".html"]!, "Cache-Control": "no-store" });
    res.end(head ? undefined : NOT_BUILT);
    return true;
  }

  const root = resolve(dir);
  const requested = pathname.endsWith("/") ? join(pathname, "index.html") : pathname;
  // Only app routes fall back to index.html; a missing asset (a path with an extension) is a plain 404.
  const file = resolveFile(root, requested) ?? (extname(requested) === "" ? resolveFile(root, "/index.html") : undefined);
  if (!file) throw new HttpError(404, "Not found");

  const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, {
    ...BASE_HEADERS,
    "Content-Type": type,
    "Content-Length": statSync(file).size,
    "Cache-Control": type.startsWith("text/html") ? "no-store" : "no-cache",
  });
  if (head) {
    res.end();
    return true;
  }
  createReadStream(file).on("error", () => res.destroy()).pipe(res);
  return true;
}

import type { IncomingMessage } from "node:http";
import { ConfigFileError, type ConfigErrorCode, type ConfigFiles } from "../../core/ports/config-files.js";
import { HttpError, sendJson } from "../http.js";
import type { RouteModule } from "../types.js";

/** Largest request body: the file limit (256 KB) with room for JSON escaping. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const STATUS: Record<ConfigErrorCode, number> = {
  forbidden: 403,
  "not-found": 404,
  invalid: 400,
  "too-large": 413,
  conflict: 409,
  io: 500,
};

let active: ConfigFiles | undefined;

/**
 * Gives the config routes their files. The composition root (`knit ui`) calls it once before the server starts;
 * without it the routes answer 503, like run control on a server started without it.
 */
export function useConfigFiles(files: ConfigFiles | undefined): void {
  active = files;
}

function files(): ConfigFiles {
  if (!active) throw new HttpError(503, "The configuration editor is not available on this server");
  return active;
}

/** Runs a port call and turns its typed failure into the matching HTTP status. */
function guarded<T>(call: () => T): T {
  try {
    return call();
  } catch (err) {
    if (err instanceof ConfigFileError) throw new HttpError(STATUS[err.code], err.message);
    throw err;
  }
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") throw new HttpError(415, "Content-Type must be application/json");
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new HttpError(413, `Body is larger than ${MAX_BODY_BYTES} bytes`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, `Body is larger than ${MAX_BODY_BYTES} bytes`);
    chunks.push(chunk as Buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Body is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new HttpError(400, "Body must be a JSON object");
  return parsed as Record<string, unknown>;
}

/**
 * The configuration editor's API. Files are named by the opaque ids `list` returns, never by a path; the port owns the
 * allow-list and every guard, so a request cannot reach anything it does not list.
 */
export const configRoutes: RouteModule = () => [
  {
    method: "GET",
    pattern: "/api/config/files",
    handler: ({ res }) => {
      sendJson(res, 200, { files: guarded(() => files().list()) });
    },
  },
  {
    method: "GET",
    pattern: "/api/config/file",
    handler: ({ res, url }) => {
      const id = url.searchParams.get("id");
      if (!id) throw new HttpError(400, "id is required");
      sendJson(res, 200, guarded(() => files().read(id)));
    },
  },
  {
    method: "PUT",
    pattern: "/api/config/file",
    handler: async ({ req, res }) => {
      const port = files();
      const body = await readJsonBody(req);
      const unknown = Object.keys(body).filter((k) => !["id", "content", "expectedHash"].includes(k));
      if (unknown.length > 0) throw new HttpError(400, `Unknown field: ${unknown.join(", ")}`);
      const { id, content, expectedHash } = body;
      if (typeof id !== "string" || id === "") throw new HttpError(400, "id must be a non-empty string");
      if (typeof content !== "string") throw new HttpError(400, "content must be a string");
      if (typeof expectedHash !== "string" || expectedHash === "") throw new HttpError(400, "expectedHash must be a non-empty string");
      sendJson(res, 200, guarded(() => port.write(id, content, expectedHash)));
    },
  },
];

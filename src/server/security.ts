import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Method } from "./types.js";

export const TOKEN_COOKIE = "knit_token";

/** A fresh token for one launch: 32 random bytes, hex. */
export const generateToken = (): string => randomBytes(32).toString("hex");

export const MUTATING_METHODS: ReadonlySet<string> = new Set<Method>(["POST", "PUT", "PATCH", "DELETE"]);

/** Constant-time comparison. Both sides are hashed first so the length of the secret does not leak either. */
export function tokensEqual(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** The token a request presents through a header or cookie (never the query string). */
function presentedToken(req: IncomingMessage): string | undefined {
  const auth = req.headers.authorization;
  if (auth !== undefined) {
    const m = /^Bearer\s+(\S+)$/i.exec(auth);
    return m?.[1];
  }
  return cookieValue(req.headers.cookie, TOKEN_COOKIE);
}

export type GuardResult = { ok: true } | { ok: false; status: number; message: string };

export interface GuardOptions {
  token: string;
  port: number;
}

/** True when the `Host` header names this server on a loopback name (DNS rebinding check). */
export function hostAllowed(req: IncomingMessage, port: number): boolean {
  const host = req.headers.host;
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

/**
 * The one gate every request passes before routing, including routes added later:
 * 1. `Host` must be `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding);
 * 2. the launch token must come from `Authorization: Bearer` or the cookie;
 * 3. mutating methods also need an `Origin` equal to the server's own origin (other websites).
 * A valid `?token=` on a GET is handled by `queryTokenRedirect`, before this check.
 */
export function guard(req: IncomingMessage, options: GuardOptions): GuardResult {
  if (!hostAllowed(req, options.port)) return { ok: false, status: 403, message: "Forbidden host" };
  const given = presentedToken(req);
  if (given === undefined || !tokensEqual(given, options.token)) {
    return { ok: false, status: 401, message: "Missing or invalid token" };
  }
  if (MUTATING_METHODS.has(req.method ?? "")) {
    const origin = req.headers.origin;
    if (origin === undefined || origin !== `http://${req.headers.host}`) {
      return { ok: false, status: 403, message: "Forbidden origin" };
    }
  }
  return { ok: true };
}

/**
 * First page load: a valid `?token=` on a GET (host already checked) becomes an `HttpOnly; SameSite=Strict` cookie and a
 * redirect to the same URL without the token. Returns undefined when the request carries no token in its query, and
 * `"invalid"` when it carries a wrong one.
 */
export function queryTokenRedirect(
  req: IncomingMessage,
  url: URL,
  options: GuardOptions,
): { location: string; setCookie: string } | "invalid" | undefined {
  if (req.method !== "GET" || !url.searchParams.has("token")) return undefined;
  const given = url.searchParams.get("token") ?? "";
  if (!tokensEqual(given, options.token)) return "invalid";
  url.searchParams.delete("token");
  // A leading `//` would be read as a protocol-relative URL, so collapse it.
  const path = url.pathname.replace(/^\/+/, "/");
  return {
    location: path + url.search,
    setCookie: `${TOKEN_COOKIE}=${options.token}; HttpOnly; SameSite=Strict; Path=/`,
  };
}

import type { Method, Route } from "./types.js";

interface Compiled {
  route: Route;
  segments: string[];
}

export type Match =
  | { kind: "found"; route: Route; params: Record<string, string> }
  | { kind: "method-not-allowed"; allow: Method[] }
  | { kind: "none" };

/** Splits a raw path into percent-decoded segments. Returns undefined when an escape is malformed. */
export function decodeSegments(pathname: string): string[] | undefined {
  try {
    return pathname
      .split("/")
      .slice(1)
      .map((s) => decodeURIComponent(s));
  } catch {
    return undefined;
  }
}

/** Matches method and path against the registered routes. A path segment starting with `:` is a parameter. */
export class Router {
  private readonly compiled: Compiled[];

  constructor(routes: Route[]) {
    this.compiled = routes.map((route) => ({ route, segments: route.pattern.split("/").slice(1) }));
  }

  match(method: string, segments: string[]): Match {
    const allow: Method[] = [];
    for (const { route, segments: pattern } of this.compiled) {
      const params = matchSegments(pattern, segments);
      if (!params) continue;
      if (route.method === method) return { kind: "found", route, params };
      allow.push(route.method);
    }
    return allow.length > 0 ? { kind: "method-not-allowed", allow } : { kind: "none" };
  }
}

function matchSegments(pattern: string[], actual: string[]): Record<string, string> | undefined {
  if (pattern.length !== actual.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]!;
    const a = actual[i]!;
    if (p.startsWith(":")) {
      if (a === "") return undefined;
      params[p.slice(1)] = a;
    } else if (p !== a) return undefined;
  }
  return params;
}

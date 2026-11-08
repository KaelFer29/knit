import { useEffect, useState } from "react";

/**
 * The app has one view, so there are no page routes. The hash only carries the run the panels pick:
 * `#/runs/<id>`. Claude's panel keeps its open session in its own state, not in the URL.
 */
export interface Route {
  /** `#/runs/<id>`: the run the view shows. Absent for the most recent run. */
  runId?: string;
}

const decode = (id: string): string | undefined => {
  try {
    return decodeURIComponent(id);
  } catch {
    return undefined;
  }
};

/** `#/runs/<id>`. Anything else selects nothing. */
export function parseRoute(hash: string): Route {
  const [, id] = /^#\/runs(?:\/([^/]+))?$/.exec(hash) ?? [];
  const decoded = id === undefined ? undefined : decode(id);
  return decoded === undefined ? {} : { runId: decoded };
}

export const runsHash = (runId?: string): string => (runId === undefined ? "#/runs" : `#/runs/${encodeURIComponent(runId)}`);

/** The current selection, following the back button and the links inside the panels. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = (): void => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

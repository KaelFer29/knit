import { useEffect, useState } from "react";

/**
 * The app has one view, so there are no page routes. The hash only carries the selection the panels make:
 * `#/runs/<id>` picks the run the view shows and `#/workspace/<id>` the open session of Claude's panel.
 */
export interface Route {
  /** `new` for the new-session form, an id for an open session, absent for neither. */
  sessionId?: string;
  /** `#/runs/<id>`: the run the view shows. Absent for the most recent run. */
  runId?: string;
}

export const NEW_SESSION = "new";

const decode = (id: string): string | undefined => {
  try {
    return decodeURIComponent(id);
  } catch {
    return undefined;
  }
};

/** `#/runs/<id>` and `#/workspace/<id>`. Anything else selects nothing. */
export function parseRoute(hash: string): Route {
  const [, kind, id] = /^#\/(runs|workspace)(?:\/([^/]+))?$/.exec(hash) ?? [];
  const decoded = id === undefined ? undefined : decode(id);
  if (decoded === undefined) return {};
  return kind === "workspace" ? { sessionId: decoded } : { runId: decoded };
}

export const runsHash = (runId?: string): string => (runId === undefined ? "#/runs" : `#/runs/${encodeURIComponent(runId)}`);

export const workspaceHash = (sessionId?: string): string => (sessionId === undefined ? "#/workspace" : `#/workspace/${encodeURIComponent(sessionId)}`);

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

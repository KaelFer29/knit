import { useEffect, useState } from "react";
import type { View } from "./molecules/NavTabs";

export interface Route {
  view: View;
  /** `new` for the new-session form, an id for an open session, absent for neither. */
  sessionId?: string;
  /** `#/runs/<id>`: the run drawn on the canvas. Absent for the runs list. */
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

/** `#/runs`, `#/runs/<id>`, `#/workspace`, `#/workspace/<id>`, `#/config`. Anything else is the runs list. */
export function parseRoute(hash: string): Route {
  const [, view, id] = /^#\/(runs|workspace|config)(?:\/([^/]+))?$/.exec(hash) ?? [];
  const decoded = id === undefined ? undefined : decode(id);
  if (view === "workspace") return decoded === undefined ? { view } : { view, sessionId: decoded };
  if (view === "config") return { view };
  return decoded === undefined ? { view: "runs" } : { view: "runs", runId: decoded };
}

export const runsHash = (runId?: string): string => (runId === undefined ? "#/runs" : `#/runs/${encodeURIComponent(runId)}`);

export const workspaceHash = (sessionId?: string): string => (sessionId === undefined ? "#/workspace" : `#/workspace/${encodeURIComponent(sessionId)}`);

/** The current route, following the back button and the links in the navigation. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = (): void => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

import { useEffect, useState } from "react";
import type { View } from "./molecules/NavTabs";

export interface Route {
  view: View;
  /** `new` for the new-session form, an id for an open session, absent for neither. */
  sessionId?: string;
}

export const NEW_SESSION = "new";

/** `#/runs`, `#/workspace`, `#/workspace/<id>`, `#/config`. Anything else is the runs view. */
export function parseRoute(hash: string): Route {
  const [, view, id] = /^#\/(runs|workspace|config)(?:\/([^/]+))?$/.exec(hash) ?? [];
  if (view === "workspace") {
    if (id === undefined) return { view };
    try {
      return { view, sessionId: decodeURIComponent(id) };
    } catch {
      return { view };
    }
  }
  if (view === "config") return { view };
  return { view: "runs" };
}

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

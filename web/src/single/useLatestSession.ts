import { useEffect, useMemo, useState } from "react";
import { fetchSessions } from "../sessions/api";
import type { SessionListEntry } from "../sessions/types";
import { useSessionLive } from "../sessions/useSessionLive";
import { glimpseOf, latestSession } from "./glimpse";
import type { SessionGlimpse } from "./pipeline";

export const SESSIONS_POLL_MS = 3000;

/** Container hook: a glimpse of the latest Claude session, kept current. Does nothing when `enabled` is false (fixtures). */
export function useLatestSession(enabled: boolean, pollMs: number = SESSIONS_POLL_MS): SessionGlimpse | undefined {
  const [entries, setEntries] = useState<SessionListEntry[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const read = (): void => {
      fetchSessions().then(
        (list) => live && setEntries(list),
        () => undefined,
      );
    };
    read();
    const timer = window.setInterval(read, pollMs);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [enabled, pollMs]);
  const id = enabled ? latestSession(entries)?.session.id : undefined;
  const session = useSessionLive(id);
  return useMemo(() => (session.detail && session.detail.session.id === id ? glimpseOf(session.detail, session.events) : undefined), [session.detail, session.events, id]);
}

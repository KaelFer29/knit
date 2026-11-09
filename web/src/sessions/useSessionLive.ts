import { useCallback, useEffect, useRef, useState } from "react";
import { fetchEventsAfter, fetchSession } from "./api";
import type { SessionDetail, SessionEvent } from "./types";

export const RUNNING_POLL_MS = 800;
export const IDLE_POLL_MS = 4000;

export interface LiveSession {
  detail: SessionDetail | undefined;
  events: SessionEvent[];
  error: string | undefined;
  /** Reads again right away (after a turn was started). */
  refresh: () => void;
}

/**
 * Keeps one session up to date: its record and turns, and its timeline entries after the last id it holds, so a poll
 * never repeats or skips an entry. Polls about once a second while a turn runs and slowly otherwise. A different
 * session id starts from scratch.
 */
export function useSessionLive(sessionId: string | undefined): LiveSession {
  const [state, setState] = useState<{ id: string; detail: SessionDetail; events: SessionEvent[] } | undefined>();
  const [error, setError] = useState<string | undefined>();
  const cursor = useRef({ id: "", last: 0 });
  const wake = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    if (sessionId === undefined) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // One poll at a time: two reading from the same cursor would deliver an entry twice.
    let busy = false;
    let again = false;
    cursor.current = { id: sessionId, last: 0 };
    setError(undefined);

    const poll = async (): Promise<void> => {
      busy = true;
      let delay = IDLE_POLL_MS;
      try {
        const detail = await fetchSession(sessionId);
        const after = cursor.current.last;
        // Only entries past the cursor: a repeated poll must never show an entry twice.
        const fresh = (await fetchEventsAfter(sessionId, after)).filter((e) => e.id > after);
        if (stopped) return;
        if (fresh.length > 0) cursor.current.last = fresh[fresh.length - 1]!.id;
        setState((prev) => ({ id: sessionId, detail, events: prev?.id === sessionId ? [...prev.events, ...fresh] : fresh }));
        setError(undefined);
        if (detail.session.status === "running") delay = RUNNING_POLL_MS;
      } catch (err) {
        if (stopped) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        busy = false;
      }
      if (again) {
        again = false;
        delay = 0;
      }
      if (!stopped) timer = setTimeout(() => void poll(), delay);
    };
    wake.current = () => {
      if (busy) {
        again = true;
        return;
      }
      if (timer !== undefined) clearTimeout(timer);
      void poll();
    };
    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      wake.current = undefined;
    };
  }, [sessionId]);

  const refresh = useCallback(() => wake.current?.(), []);
  const current = state !== undefined && state.id === sessionId ? state : undefined;
  return { detail: current?.detail, events: current?.events ?? [], error, refresh };
}

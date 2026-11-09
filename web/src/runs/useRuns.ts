import { useCallback, useEffect, useState } from "react";
import { fetchRuns } from "./api";
import type { RunListItem } from "./types";

export const RUNS_POLL_MS = 3000;

export interface RunsState {
  runs: RunListItem[] | undefined;
  /** Set when the last read failed. The previous list stays, so a hiccup does not blank the page. */
  error: string | undefined;
  reload: () => void;
}

/** Container hook: the runs list, reread every few seconds so a started or finished run shows up without a click. */
export function useRuns(pollMs: number = RUNS_POLL_MS, load: () => Promise<RunListItem[]> = fetchRuns): RunsState {
  const [runs, setRuns] = useState<RunListItem[]>();
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const read = (): void => {
      load().then(
        (list) => {
          if (!live) return;
          setRuns(list);
          setError(undefined);
        },
        (err: unknown) => live && setError(err instanceof Error ? err.message : "Could not load the runs"),
      );
    };
    read();
    const timer = window.setInterval(read, pollMs);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
    // `load` is a stable module function in the app; tests pass one per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { runs, error, reload };
}

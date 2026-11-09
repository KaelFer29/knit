import { useCallback, useEffect, useState } from "react";
import { fetchRunsPage, type RunsPage, type RunsQuery } from "./api";

export const RUNS_POLL_MS = 3000;

export interface RunsState {
  /** The runs of the page asked for; undefined until the first read. */
  runs: RunsPage["runs"] | undefined;
  /** How many runs match in all. */
  total: number;
  /** Set when the last read failed. The previous page stays, so a hiccup does not blank the page. */
  error: string | undefined;
  reload: () => void;
}

/**
 * Container hook: one page of the runs list, reread every few seconds so a started or finished run shows up without a
 * click, and again whenever the page, the search or the filter changes. The server does the paging.
 */
export function useRunsPage(query: RunsQuery, pollMs: number = RUNS_POLL_MS, load: (query: RunsQuery) => Promise<RunsPage> = fetchRunsPage): RunsState {
  const [page, setPage] = useState<RunsPage>();
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  const key = `${query.limit}|${query.offset}|${query.q ?? ""}|${query.status ?? ""}`;
  useEffect(() => {
    let live = true;
    const read = (): void => {
      load(query).then(
        (next) => {
          if (!live) return;
          setPage(next);
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
    // `query` is read through `key`: a new object with the same values is not a new request. `load` is a stable module function in the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pollMs, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { runs: page?.runs, total: page?.total ?? 0, error, reload };
}

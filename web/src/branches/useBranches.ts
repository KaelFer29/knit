import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { fetchBranches } from "./api";
import type { BranchListing } from "./types";

export const BRANCHES_POLL_MS = 5000;

export interface BranchesState {
  listing: BranchListing | undefined;
  /** Set when the last read failed. The previous listing stays, so a hiccup does not blank the page. */
  error: string | undefined;
  reload: () => void;
}

/** Container hook: the branches of a run, read again every few seconds and after every action. */
export function useBranches(runId: string, pollMs: number = BRANCHES_POLL_MS): BranchesState {
  const [listing, setListing] = useState<BranchListing>();
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const read = (): void => {
      fetchBranches(runId).then(
        (l) => {
          if (!live) return;
          setListing(l);
          setError(undefined);
        },
        (err: unknown) => live && setError(err instanceof ApiError || err instanceof Error ? err.message : "Could not read the branches"),
      );
    };
    read();
    const timer = setInterval(read, pollMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [runId, pollMs, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { listing: listing?.runId === runId ? listing : undefined, error, reload };
}

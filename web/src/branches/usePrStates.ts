import { useEffect, useState } from "react";
import { fetchBranches } from "./api";
import type { BranchView } from "./types";

export const PR_STATES_POLL_MS = 10_000;

export type PrStates = Record<string, NonNullable<BranchView["prState"]>>;

/**
 * Container hook: the state of each task's pull request (open, merged, closed), by task id. It asks the branches route,
 * which asks GitHub, so it only does so when asked to (`enabled`: a real run with at least one pull request).
 * A failed read keeps what was known: a label that flickers away is worse than one a few seconds old.
 */
export function usePrStates(runId: string | undefined, enabled: boolean, pollMs: number = PR_STATES_POLL_MS): PrStates {
  const [states, setStates] = useState<PrStates>({});
  useEffect(() => {
    if (runId === undefined || !enabled) return;
    let live = true;
    const read = (): void => {
      fetchBranches(runId).then(
        (listing) => {
          if (!live) return;
          setStates(Object.fromEntries((listing.branches ?? []).flatMap((b) => (b.prState ? [[b.taskId, b.prState] as const] : []))));
        },
        () => undefined,
      );
    };
    read();
    const timer = window.setInterval(read, pollMs);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [runId, enabled, pollMs]);
  return states;
}

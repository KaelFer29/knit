import { useCallback, useEffect, useState } from "react";
import { fetchPlans, type PlanListing } from "./plans";

export const PLANS_POLL_MS = 3000;

/**
 * The draft plans of a session, read again every few seconds (Claude writes one while the user watches) and on demand.
 * A failed read keeps the last listing: the cards are an extra, never a reason to hide the conversation.
 */
export function usePlanDrafts(sessionId: string | undefined): { listing: PlanListing | undefined; refresh: () => void } {
  const [state, setState] = useState<{ id: string | undefined; listing: PlanListing | undefined }>({ id: undefined, listing: undefined });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (sessionId === undefined) return;
    let stopped = false;
    const read = (): void => {
      fetchPlans(sessionId).then(
        (listing) => !stopped && setState({ id: sessionId, listing }),
        () => undefined,
      );
    };
    read();
    const timer = setInterval(read, PLANS_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [sessionId, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { listing: state.id === sessionId ? state.listing : undefined, refresh };
}

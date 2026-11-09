import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { fetchPlanUsage } from "./api";
import type { PlanWindow } from "./types";

export const PLAN_USAGE_POLL_MS = 60_000;

export interface PlanUsageState {
  windows: PlanWindow[];
  checkedAt?: string;
  loading: boolean;
  error?: string;
  refresh: () => void;
}

/** Container hook: the plan windows of an agent, read at once and then every `intervalMs` while `enabled`. */
export function usePlanUsage(agent: string | undefined, enabled: boolean, intervalMs: number = PLAN_USAGE_POLL_MS): PlanUsageState {
  const [windows, setWindows] = useState<PlanWindow[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const live = useRef(true);

  const read = useCallback(() => {
    if (agent === undefined) return;
    setLoading(true);
    fetchPlanUsage(agent).then(
      (r) => {
        if (!live.current) return;
        setWindows(r.windows);
        setCheckedAt(r.checkedAt);
        setError(undefined);
        setLoading(false);
      },
      (err: unknown) => {
        if (!live.current) return;
        setError(err instanceof ApiError || err instanceof Error ? err.message : String(err));
        setLoading(false);
      },
    );
  }, [agent]);

  useEffect(() => {
    live.current = true;
    if (!enabled || agent === undefined) return;
    read();
    const timer = window.setInterval(read, intervalMs);
    return () => {
      live.current = false;
      window.clearInterval(timer);
    };
  }, [enabled, agent, intervalMs, read]);

  return { windows, ...(checkedAt === undefined ? {} : { checkedAt }), loading, ...(error === undefined ? {} : { error }), refresh: read };
}

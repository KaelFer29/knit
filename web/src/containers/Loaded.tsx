import type { ReactNode } from "react";
import { useLoad } from "../detail/useLoad";
import "../organisms/detail.css";

interface Props<T> {
  load: () => Promise<T>;
  /** Reload every so many milliseconds while mounted (an open attempt's live timeline). */
  pollMs?: number;
  children: (value: T) => ReactNode;
}

/** Container: loads once on mount and shows a loading line, the error message or the loaded content. */
export function Loaded<T>({ load, pollMs, children }: Props<T>) {
  const state = useLoad(load, pollMs);
  if (state.status === "loading") return <p className="detail-note" role="status">Loading…</p>;
  if (state.status === "error") return <p className="detail-note detail-note--error" role="alert">{state.message}</p>;
  return <>{children(state.value)}</>;
}

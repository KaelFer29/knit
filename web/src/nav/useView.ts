import { useCallback, useEffect, useState } from "react";

export type View = "flow" | "config";

const HASHES: Record<View, string> = { flow: "", config: "#/config" };

const fromHash = (hash: string): View => (hash === HASHES.config ? "config" : "flow");

/** The current view, kept in the URL hash so a reload and the back button keep working. */
export function useView(): [View, (view: View) => void] {
  const [view, setViewState] = useState<View>(() => fromHash(window.location.hash));
  useEffect(() => {
    const onChange = (): void => setViewState(fromHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const setView = useCallback((next: View) => {
    window.location.hash = HASHES[next];
    setViewState(next);
  }, []);
  return [view, setView];
}

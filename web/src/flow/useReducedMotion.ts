import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

const hasMatchMedia = () => typeof window !== "undefined" && typeof window.matchMedia === "function";

function subscribe(onChange: () => void): () => void {
  if (!hasMatchMedia()) return () => {};
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

const snapshot = () => hasMatchMedia() && window.matchMedia(QUERY).matches;

/** True when the person asked for less motion. Follows the setting live. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

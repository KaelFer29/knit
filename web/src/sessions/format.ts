/** Presentation helpers for sessions. Pure; `now` is a parameter so tests need no clock. */

/** `just now`, `5m ago`, `3h ago`, `2d ago`; falls back to the date for anything older than two weeks. */
export function formatAgo(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days <= 14) return `${days}d ago`;
  return new Date(then).toISOString().slice(0, 10);
}

/** `resets in 2h 10m` for a Unix time in seconds, or `` when it is unknown or already past. */
export function formatResetsIn(resetsAtSeconds: number | undefined, now: number): string {
  if (resetsAtSeconds === undefined) return "";
  const minutes = Math.round((resetsAtSeconds * 1000 - now) / 60_000);
  if (minutes <= 0) return "";
  if (minutes < 60) return `resets in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `resets in ${hours}h ${minutes % 60}m`;
  return `resets in ${Math.round(hours / 24)}d`;
}

const WINDOW_LABELS: Record<string, string> = { five_hour: "5-hour window", seven_day: "7-day window" };

/** A rate-limit window's name as people say it; an unknown one is shown as the agent named it. */
export const windowLabel = (name: string): string => WINDOW_LABELS[name] ?? name.replace(/_/g, " ");

/** `38%` from a 0 to 1 fraction, clamped. */
export const percent = (fraction: number): number => Math.round(Math.min(1, Math.max(0, fraction)) * 100);

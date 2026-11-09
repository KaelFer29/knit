/** Small presentation helpers shared by the canvas components. Pure. */
import type { TokenTotals } from "@board";

/** `842`, `4.9k`, `158k`, `1.25M`. */
export function formatTokens(count: number): string {
  const trim = (value: number, digits: number) => String(Number(value.toFixed(digits)));
  if (count < 1_000) return String(count);
  if (count < 100_000) return `${trim(count / 1_000, 1)}k`;
  if (count < 1_000_000) return `${trim(count / 1_000, 0)}k`;
  return `${trim(count / 1_000_000, 2)}M`;
}

export const totalTokens = (tokens: TokenTotals): number => tokens.input + tokens.output;

/** `14s`, `5m 14s`, `21m`, `1h 15m`. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = seconds % 60;
    return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export const shortSha = (sha: string): string => sha.slice(0, 7);

/** `PR #42` from a pull request URL, or plain `PR` when the number cannot be read. */
export function prLabel(url: string): string {
  const match = /\/pull\/(\d+)/.exec(url);
  return match?.[1] === undefined ? "PR" : `PR #${match[1]}`;
}

/** The URL when it is http(s), otherwise `undefined`: stored values are untrusted and never become `javascript:` links. */
export function safeHttpUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : undefined;
  } catch {
    return undefined;
  }
}

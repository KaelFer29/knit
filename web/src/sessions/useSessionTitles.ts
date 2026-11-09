import { useCallback, useSyncExternalStore } from "react";

const KEY = "knit.session-titles";

function read(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return {};
  }
}

function write(titles: Record<string, string>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(titles));
  } catch {
    // Storage can be blocked; the new name then lasts only while the page is open.
  }
}

/** One copy of the names for the whole page, so a rename in the panel reaches the block at once. */
let current: Record<string, string> | undefined;
const listeners = new Set<() => void>();

const snapshot = (): Record<string, string> => (current ??= read());
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function set(next: Record<string, string>): void {
  current = next;
  write(next);
  for (const listener of listeners) listener();
}

/**
 * The names the person gave to conversations. They live in this browser, next to the page, because Knit's database is
 * written only by the agents' own processes; a name never reaches the agent or other browsers. Every user of the hook
 * shares them, so the panel and the block always show the same name.
 */
export function useSessionTitles(): { titleOf: (id: string, original: string) => string; rename: (id: string, title: string) => void } {
  const titles = useSyncExternalStore(subscribe, snapshot);
  const rename = useCallback((id: string, title: string): void => {
    const next = { ...snapshot() };
    const clean = title.trim().slice(0, 80);
    if (clean === "") delete next[id];
    else next[id] = clean;
    set(next);
  }, []);
  const titleOf = useCallback((id: string, original: string): string => titles[id] ?? original, [titles]);
  return { titleOf, rename };
}

/** Forgets the shared copy so the next read goes to storage again. For tests. */
export function resetSessionTitles(): void {
  current = undefined;
  for (const listener of listeners) listener();
}

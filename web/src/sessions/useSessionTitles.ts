import { useCallback, useState } from "react";

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

/**
 * The names the person gave to conversations. They live in this browser, next to the page, because Knit's database is
 * written only by the agents' own processes; a name never reaches the agent or other browsers.
 */
export function useSessionTitles(): { titleOf: (id: string, original: string) => string; rename: (id: string, title: string) => void } {
  const [titles, setTitles] = useState(read);
  const rename = useCallback((id: string, title: string): void => {
    setTitles((current) => {
      const next = { ...current };
      const clean = title.trim().slice(0, 80);
      if (clean === "") delete next[id];
      else next[id] = clean;
      write(next);
      return next;
    });
  }, []);
  const titleOf = useCallback((id: string, original: string): string => titles[id] ?? original, [titles]);
  return { titleOf, rename };
}

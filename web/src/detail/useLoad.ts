import { useEffect, useState } from "react";

export type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; value: T };

/** Runs `load` once when the component mounts (a closed panel is never mounted, so nothing is fetched until it opens). */
export function useLoad<T>(load: () => Promise<T>, pollMs?: number): Load<T> {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  useEffect(() => {
    let live = true;
    const run = (): void => {
      load().then(
        (value) => live && setState({ status: "ready", value }),
        // A failed refresh keeps what was loaded; only the first load reports its error.
        (err: unknown) => live && setState((prev) => (prev.status === "ready" ? prev : { status: "error", message: err instanceof Error ? err.message : "Could not load" })),
      );
    };
    run();
    const timer = pollMs === undefined ? undefined : setInterval(run, pollMs);
    return () => {
      live = false;
      if (timer !== undefined) clearInterval(timer);
    };
    // The loader is created fresh on every render; the panel loads once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}

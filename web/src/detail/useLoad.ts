import { useEffect, useState } from "react";

export type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; value: T };

/** Runs `load` once when the component mounts (a closed panel is never mounted, so nothing is fetched until it opens). */
export function useLoad<T>(load: () => Promise<T>): Load<T> {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  useEffect(() => {
    let live = true;
    load().then(
      (value) => live && setState({ status: "ready", value }),
      (err: unknown) => live && setState({ status: "error", message: err instanceof Error ? err.message : "Could not load" }),
    );
    return () => {
      live = false;
    };
    // The loader is created fresh on every render; the panel loads once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}

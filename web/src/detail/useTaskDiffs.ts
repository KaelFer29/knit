import { useEffect, useState } from "react";
import type { DetailSource, TaskDiffData } from "./types";

export type TaskDiffState = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; diff: TaskDiffData };

/** Container hook: what each of the given tasks changed, read once per task while it is asked for. */
export function useTaskDiffs(source: DetailSource | undefined, taskIds: string[]): Record<string, TaskDiffState> {
  const [diffs, setDiffs] = useState<Record<string, TaskDiffState>>({});
  const key = taskIds.join("\n");
  useEffect(() => {
    if (source === undefined) return;
    let live = true;
    for (const id of taskIds) {
      setDiffs((all) => (all[id] === undefined ? { ...all, [id]: { state: "loading" } } : all));
      source.diff(id).then(
        (diff) => live && setDiffs((all) => ({ ...all, [id]: { state: "ready", diff } })),
        (err: unknown) => live && setDiffs((all) => ({ ...all, [id]: { state: "error", message: err instanceof Error ? err.message : String(err) } })),
      );
    }
    return () => {
      live = false;
    };
    // `taskIds` is read through `key`: a new array with the same ids is not a new request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, key]);
  return diffs;
}

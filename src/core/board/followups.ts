import type { EventRecord } from "../ports/run-store.js";

/**
 * The tasks with a follow-up in progress: one that started (`followup.started`) and did not finish
 * (`followup.finished`). Replays the lifecycle events oldest first. A follow-up runs on a finished run, so the run
 * status alone cannot say that something is still working.
 */
export function openFollowups(events: readonly EventRecord[]): Set<string> {
  const open = new Set<string>();
  for (const e of events) {
    if (e.taskId === undefined) continue;
    if (e.type === "followup.started") open.add(e.taskId);
    else if (e.type === "followup.finished") open.delete(e.taskId);
  }
  return open;
}

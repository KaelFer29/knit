import type { EventRecord } from "../ports/run-store.js";

/**
 * What the follow-ups of a task asked for after its last pull request was opened (all of them when none was), oldest
 * first. A second pull request exists because of them, so its description says so. Pure: it only reads the events.
 */
export function correctionsSince(events: readonly EventRecord[], taskId: string): string[] {
  let after = -1;
  events.forEach((e, i) => {
    if (e.taskId === taskId && e.type === "branch.pr_opened") after = i;
  });
  return events.slice(after + 1).flatMap((e) => {
    if (e.taskId !== taskId || e.type !== "followup.started") return [];
    const prompt = (e.payload as { prompt?: unknown } | undefined)?.prompt;
    return typeof prompt === "string" && prompt.trim() !== "" ? [prompt.trim()] : [];
  });
}

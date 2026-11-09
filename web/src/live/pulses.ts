import type { StreamedEvent } from "../api/stream";
import { strandId } from "../flow/geometry";
import type { Pulse } from "../flow/pulses";

/**
 * The pulse a lifecycle event makes, if any: a task starting leaves Claude for Knit, an attempt starting sends the
 * prompt to the builder, an attempt finishing brings the result back.
 */
export function pulseForEvent(event: Pick<StreamedEvent, "id" | "type" | "taskId">): Pulse | undefined {
  if (event.taskId === undefined) return undefined;
  const id = `live-${event.id}`;
  switch (event.type) {
    case "task.started":
      return { id, wireId: strandId("plan", event.taskId), kind: "dispatched" };
    case "attempt.started":
      return { id, wireId: strandId("prompt", event.taskId), kind: "prompt" };
    case "attempt.finished":
      return { id, wireId: strandId("result", event.taskId), kind: "result" };
    default:
      return undefined;
  }
}

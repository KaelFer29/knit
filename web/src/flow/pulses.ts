/**
 * Pulses: a small dot that travels along a wire when something moves through it.
 * The canvas only draws the pulses it is given, so live events and the demo mode share one path.
 */
import type { BoardModel, WireId } from "@board";
import { strandId } from "./geometry";

/** `dispatched`: a task leaves Claude for Knit. `prompt`: Knit sends the prompt to the builder. `result`: the builder's result returns. */
export type PulseKind = "dispatched" | "prompt" | "result";

export interface Pulse {
  /** Unique per pulse, so the same strand can pulse twice. */
  id: string;
  /** A strand id (`prompt:T3`) or a bare wire id (`prompt`), which uses the wire's first strand or its idle lane. */
  wireId: string;
  kind: PulseKind;
}

export function pulseKindWire(kind: PulseKind): WireId {
  return kind === "dispatched" ? "plan" : kind;
}

export const DEMO_SEQUENCE: readonly PulseKind[] = ["dispatched", "prompt", "result"];

/**
 * The pulse the demo mode plays at `step`. It dispatches the first queued task, then follows the running one:
 * the prompt goes out and the result comes back. Boards with neither fall back to their first task.
 */
export function demoPulse(board: BoardModel, step: number): Pulse | undefined {
  const kind = DEMO_SEQUENCE[step % DEMO_SEQUENCE.length];
  if (kind === undefined) return undefined;
  const queued = board.queue[0]?.taskId;
  const running = board.active?.taskId;
  const first = board.tasks[0]?.taskId;
  const taskId = kind === "dispatched" ? (queued ?? running ?? first) : (running ?? first);
  if (taskId === undefined) return undefined;
  return { id: `demo-${step}`, wireId: strandId(pulseKindWire(kind), taskId), kind };
}

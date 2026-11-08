import type { EventRecord } from "../ports/run-store.js";

/** What the lifecycle events say about one attempt. Attempt rows are only written when an attempt ends. */
export interface TrackedAttempt {
  startedAt: string;
  /** Set by `attempt.finished`. */
  finished: boolean;
  /** Latest `check.started` command: the agent finished and Knit is checking its work. */
  checking?: string;
  checkStartedAt?: string;
}

export interface TaskTrace {
  attempts: Map<number, TrackedAttempt>;
  /** From the task's last `task.failed` event. */
  failureReason?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Replays lifecycle events (oldest first) per task.
 * `attempt.started` always resets its attempt: after a crash, a resumed run reuses the number of the attempt that
 * never finished, and the new start is the one that counts.
 */
export function traceEvents(events: readonly EventRecord[]): Map<string, TaskTrace> {
  const traces = new Map<string, TaskTrace>();
  const traceOf = (taskId: string): TaskTrace => {
    let trace = traces.get(taskId);
    if (!trace) traces.set(taskId, (trace = { attempts: new Map() }));
    return trace;
  };
  for (const e of events) {
    if (e.taskId === undefined) continue;
    const trace = traceOf(e.taskId);
    const payload = isRecord(e.payload) ? e.payload : {};
    const tracked = e.attempt === undefined ? undefined : trace.attempts.get(e.attempt);
    switch (e.type) {
      case "attempt.started":
        if (e.attempt !== undefined) trace.attempts.set(e.attempt, { startedAt: e.ts, finished: false });
        break;
      case "check.started":
        if (tracked && typeof payload.command === "string") {
          tracked.checking = payload.command;
          tracked.checkStartedAt = e.ts;
        }
        break;
      case "attempt.finished":
        if (tracked) tracked.finished = true;
        break;
      case "task.failed":
        if (typeof payload.reason === "string") trace.failureReason = payload.reason;
        break;
    }
  }
  return traces;
}

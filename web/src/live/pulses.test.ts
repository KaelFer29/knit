import { describe, expect, it } from "vitest";
import { pulseForEvent } from "./pulses";

describe("pulseForEvent", () => {
  it("maps lifecycle events to pulses on the task's strand", () => {
    expect(pulseForEvent({ id: 1, type: "task.started", taskId: "T1" })).toEqual({ id: "live-1", wireId: "plan:T1", kind: "dispatched" });
    expect(pulseForEvent({ id: 2, type: "attempt.started", taskId: "T1" })).toEqual({ id: "live-2", wireId: "prompt:T1", kind: "prompt" });
    expect(pulseForEvent({ id: 3, type: "attempt.finished", taskId: "T2" })).toEqual({ id: "live-3", wireId: "result:T2", kind: "result" });
  });
  it("ignores other events and events without a task", () => {
    expect(pulseForEvent({ id: 4, type: "check.started", taskId: "T1" })).toBeUndefined();
    expect(pulseForEvent({ id: 5, type: "attempt.started" })).toBeUndefined();
  });
});

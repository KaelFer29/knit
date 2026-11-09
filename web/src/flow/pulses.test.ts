import { describe, expect, it } from "vitest";
import { deliveredRun, longQueueRun, runningRun } from "../fixtures/boards";
import { DEMO_SEQUENCE, demoPulse, pulseKindWire } from "./pulses";

describe("pulseKindWire", () => {
  it("maps each kind to the wire it travels on", () => {
    expect(pulseKindWire("dispatched")).toBe("plan");
    expect(pulseKindWire("prompt")).toBe("prompt");
    expect(pulseKindWire("result")).toBe("result");
  });
});

describe("demoPulse", () => {
  it("cycles dispatched, prompt, result", () => {
    expect(DEMO_SEQUENCE).toEqual(["dispatched", "prompt", "result"]);
    const kinds = [0, 1, 2, 3].map((step) => demoPulse(runningRun, step)!.kind);
    expect(kinds).toEqual(["dispatched", "prompt", "result", "dispatched"]);
  });

  it("follows the running task for the prompt and the result", () => {
    expect(demoPulse(runningRun, 1)).toEqual({ id: "demo-1", wireId: "prompt:T3", kind: "prompt" });
    expect(demoPulse(runningRun, 2)).toEqual({ id: "demo-2", wireId: "result:T3", kind: "result" });
  });

  it("dispatches the first queued task", () => {
    expect(demoPulse(runningRun, 0)).toEqual({ id: "demo-0", wireId: "plan:T4", kind: "dispatched" });
    expect(demoPulse(longQueueRun, 0)!.wireId).toBe("plan:T2");
  });

  it("falls back to the first task when nothing is running or queued", () => {
    expect(demoPulse(deliveredRun, 0)!.wireId).toBe("plan:T1");
  });
});

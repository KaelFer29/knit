import { describe, expect, it } from "vitest";
import type { EventRecord } from "../ports/run-store.js";
import { correctionsSince } from "./corrections.js";

const ev = (type: string, taskId: string | undefined, payload?: unknown): EventRecord => ({ runId: "r", ts: "2026-11-09T10:00:00.000Z", type, ...(taskId ? { taskId } : {}), ...(payload !== undefined ? { payload } : {}) });
const asked = (taskId: string, prompt: string) => ev("followup.started", taskId, { prompt });

describe("correctionsSince", () => {
  it("returns what the follow-ups of the task asked for after its last pull request, oldest first", () => {
    const events = [asked("T1", "old"), ev("branch.pr_opened", "T1", { url: "u1" }), asked("T1", "first"), asked("T1", "second")];
    expect(correctionsSince(events, "T1")).toEqual(["first", "second"]);
  });

  it("uses the last pull request when there were several", () => {
    const events = [asked("T1", "a"), ev("branch.pr_opened", "T1"), asked("T1", "b"), ev("branch.pr_opened", "T1"), asked("T1", "c")];
    expect(correctionsSince(events, "T1")).toEqual(["c"]);
  });

  it("returns every follow-up when the task never had a pull request recorded", () => {
    expect(correctionsSince([asked("T1", "a"), asked("T1", "b")], "T1")).toEqual(["a", "b"]);
  });

  it("ignores other tasks, follow-ups with no prompt and blank ones, and is empty with no follow-ups", () => {
    const events = [asked("T2", "other task"), ev("followup.started", "T1", { sessionId: "s" }), asked("T1", "   "), ev("attempt.started", "T1")];
    expect(correctionsSince(events, "T1")).toEqual([]);
    expect(correctionsSince([], "T1")).toEqual([]);
  });

  it("is not confused by a pull request of another task", () => {
    expect(correctionsSince([asked("T1", "a"), ev("branch.pr_opened", "T2"), asked("T1", "b")], "T1")).toEqual(["a", "b"]);
  });
});

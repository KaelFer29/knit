import { describe, expect, it } from "vitest";
import type { EventRecord } from "../ports/run-store.js";
import { openFollowups } from "./followups.js";

const ev = (type: string, taskId?: string): EventRecord => ({ runId: "r", ts: "2026-11-09T10:00:00.000Z", type, ...(taskId ? { taskId } : {}) });

describe("openFollowups", () => {
  it("lists the tasks whose follow-up started and has not finished", () => {
    expect([...openFollowups([ev("followup.started", "T1")])]).toEqual(["T1"]);
  });

  it("forgets a task once its follow-up finished, and only that task", () => {
    const open = openFollowups([ev("followup.started", "T1"), ev("followup.started", "T2"), ev("followup.finished", "T1")]);
    expect([...open]).toEqual(["T2"]);
  });

  it("counts a second follow-up on the same task after the first one finished", () => {
    const events = [ev("followup.started", "T1"), ev("followup.finished", "T1"), ev("followup.started", "T1")];
    expect([...openFollowups(events)]).toEqual(["T1"]);
  });

  it("is empty with no follow-ups, and ignores events that belong to no task and other events", () => {
    expect(openFollowups([]).size).toBe(0);
    expect(openFollowups([ev("followup.started"), ev("attempt.started", "T1"), ev("run.finished")]).size).toBe(0);
  });
});

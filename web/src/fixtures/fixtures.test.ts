import { describe, expect, it } from "vitest";
import type { BoardModel, TaskState } from "@board";
import { ALL_FIXTURES, legacyRun, longQueueRun, runningRun } from "./boards";

const STATES: TaskState[] = ["queued", "running", "retrying", "verifying", "delivered", "failed"];

const statesIn = (boards: BoardModel[]) => new Set(boards.flatMap((b) => b.tasks.map((t) => t.state)));

describe("board fixtures", () => {
  it("covers every task state", () => {
    const seen = statesIn(Object.values(ALL_FIXTURES));
    for (const state of STATES) expect(seen.has(state), state).toBe(true);
  });

  it("keeps queue, delivery and totals consistent with the tasks", () => {
    for (const [name, board] of Object.entries(ALL_FIXTURES)) {
      const queued = board.tasks.filter((t) => t.state === "queued");
      expect(board.queue.map((q) => q.taskId), name).toEqual(queued.map((t) => t.taskId));
      const delivered = board.tasks.filter((t) => t.state === "delivered");
      expect(board.delivery.map((d) => d.taskId), name).toEqual(delivered.map((t) => t.taskId));
      expect(board.totals.tasks.total, name).toBe(board.tasks.length);
      for (const state of STATES) {
        expect(board.totals.tasks[state], `${name} ${state}`).toBe(board.tasks.filter((t) => t.state === state).length);
      }
      expect(board.wires.map((w) => w.id), name).toEqual(["plan", "prompt", "result"]);
    }
  });

  it("has a plan with Depends links", () => {
    expect(runningRun.tasks.some((t) => t.dependsOn !== undefined)).toBe(true);
  });

  it("has a queue of several tasks", () => {
    expect(longQueueRun.queue.length).toBeGreaterThanOrEqual(5);
  });

  it("has token totals per agent and a live line", () => {
    expect(runningRun.totals.tokens.cursor.input).toBeGreaterThan(0);
    expect(runningRun.liveLine?.text).toBeTruthy();
  });

  it("includes a run from before schema 4, without goal, specs or dependencies", () => {
    expect(legacyRun.nodes.claude.hasPlanText).toBe(false);
    for (const task of legacyRun.tasks) {
      expect(task.goal).toBeUndefined();
      expect(task.dependsOn).toBeUndefined();
      expect(task.specs).toEqual([]);
    }
  });
});

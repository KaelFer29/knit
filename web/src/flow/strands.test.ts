import { describe, expect, it } from "vitest";
import { deliveredRun, failedRun, runningRun } from "../fixtures/boards";
import { boardStrands, resolvePulsePath } from "./strands";

describe("boardStrands", () => {
  it("takes the strands of each wire from the board, in order", () => {
    expect(boardStrands(runningRun)).toEqual({
      plan: ["T1", "T2", "T3", "T4", "T5", "T6"],
      prompt: ["T1", "T2", "T3"],
      result: ["T1", "T2"],
    });
  });

  it("keeps a failed task on the wires it used", () => {
    const strands = boardStrands(failedRun);
    expect(strands.prompt).toEqual(["T1", "T2"]);
    expect(strands.result).toEqual(["T1", "T2"]);
  });

  it("carries every task on the plan wire once the run is delivered", () => {
    expect(boardStrands(deliveredRun).plan).toEqual(["T1", "T2", "T3"]);
  });
});

describe("resolvePulsePath", () => {
  const paths = [
    { id: "plan:T1", wire: "plan" },
    { id: "plan:T2", wire: "plan" },
    { id: "prompt", wire: "prompt" },
  ];

  it("finds a strand by its id", () => {
    expect(resolvePulsePath(paths, "plan:T2")?.id).toBe("plan:T2");
  });

  it("falls back to the first path of a bare wire id", () => {
    expect(resolvePulsePath(paths, "plan")?.id).toBe("plan:T1");
    expect(resolvePulsePath(paths, "prompt")?.id).toBe("prompt");
  });

  it("finds nothing for a wire that is not drawn", () => {
    expect(resolvePulsePath(paths, "plan:T9")).toBeUndefined();
    expect(resolvePulsePath(paths, "result")).toBeUndefined();
  });
});

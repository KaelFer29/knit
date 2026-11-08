import { describe, expect, it } from "vitest";
import { parseRoute, runsHash, workspaceHash } from "./route";

describe("selection hashes", () => {
  it("reads the run a panel picked from #/runs/<id>", () => {
    expect(parseRoute("#/runs/run-1")).toEqual({ runId: "run-1" });
    expect(parseRoute("#/runs/a%2Fb")).toEqual({ runId: "a/b" });
    expect(parseRoute(runsHash("x y"))).toEqual({ runId: "x y" });
    expect(runsHash()).toBe("#/runs");
  });

  it("reads the open session from #/workspace/<id>", () => {
    expect(parseRoute("#/workspace/chat-1")).toEqual({ sessionId: "chat-1" });
    expect(parseRoute("#/workspace/a%20b")).toEqual({ sessionId: "a b" });
    expect(parseRoute(workspaceHash("x/y z"))).toEqual({ sessionId: "x/y z" });
    expect(workspaceHash()).toBe("#/workspace");
  });

  it("selects nothing for page routes that no longer exist, a bare prefix, a bad escape or extra segments", () => {
    for (const hash of ["", "#/runs", "#/workspace", "#/config", "#/nope", "#/workspace/%E0%A4%A", "#/runs/%E0%A4%A", "#/workspace/a/b"]) {
      expect(parseRoute(hash)).toEqual({});
    }
  });
});

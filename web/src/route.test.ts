import { describe, expect, it } from "vitest";
import { parseRoute, workspaceHash } from "./route";

describe("parseRoute", () => {
  it("defaults to the runs view", () => {
    expect(parseRoute("")).toEqual({ view: "runs" });
    expect(parseRoute("#/runs")).toEqual({ view: "runs" });
    expect(parseRoute("#/nope")).toEqual({ view: "runs" });
  });

  it("reads the workspace and an optional session id", () => {
    expect(parseRoute("#/workspace")).toEqual({ view: "workspace" });
    expect(parseRoute("#/workspace/chat-1")).toEqual({ view: "workspace", sessionId: "chat-1" });
    expect(parseRoute("#/workspace/a%20b")).toEqual({ view: "workspace", sessionId: "a b" });
  });

  it("survives a malformed escape and extra segments", () => {
    expect(parseRoute("#/workspace/%E0%A4%A")).toEqual({ view: "workspace" });
    expect(parseRoute("#/workspace/a/b")).toEqual({ view: "runs" });
  });

  it("builds hashes that parse back", () => {
    expect(workspaceHash()).toBe("#/workspace");
    expect(parseRoute(workspaceHash("x/y z"))).toEqual({ view: "workspace", sessionId: "x/y z" });
  });
});

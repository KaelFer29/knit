import { describe, expect, it } from "vitest";
import { confinePath, touchedPaths } from "./file-activity.js";

const started = (tool: string, args: unknown) => ({ kind: "tool_started", payload: { tool, args } });

describe("confinePath", () => {
  it("keeps a relative path, dropping leading ./ and empty segments", () => {
    expect(confinePath("./src//a.ts")).toBe("src/a.ts");
  });

  it("turns an absolute path inside the root into a relative one", () => {
    expect(confinePath("/wt/t1/src/a.ts", "/wt/t1")).toBe("src/a.ts");
  });

  it("refuses absolute paths outside the root, or without a root", () => {
    expect(confinePath("/etc/passwd", "/wt/t1")).toBeUndefined();
    expect(confinePath("/wt/t10/a.ts", "/wt/t1")).toBeUndefined();
    expect(confinePath("/wt/t1/a.ts")).toBeUndefined();
  });

  it("refuses parent segments, backslashes, NUL bytes, the root itself and empty values", () => {
    expect(confinePath("../secret")).toBeUndefined();
    expect(confinePath("src/../../secret")).toBeUndefined();
    expect(confinePath("src\\a.ts")).toBeUndefined();
    expect(confinePath("a\0b")).toBeUndefined();
    expect(confinePath("/wt/t1", "/wt/t1")).toBeUndefined();
    expect(confinePath("   ")).toBeUndefined();
    expect(confinePath(42)).toBeUndefined();
  });
});

describe("touchedPaths", () => {
  it("reads the path of Claude file tools (file_path, notebook_path)", () => {
    const entries = [
      started("Read", { file_path: "/wt/t1/src/a.ts" }),
      started("Edit", { file_path: "/wt/t1/src/b.ts" }),
      started("NotebookEdit", { notebook_path: "/wt/t1/n.ipynb" }),
    ];
    expect(touchedPaths(entries, "/wt/t1")).toEqual(["src/a.ts", "src/b.ts", "n.ipynb"]);
  });

  it("reads the path of Cursor tool calls (args.path), whatever the tool is named", () => {
    const entries = [
      started("readToolCall", { path: "src/a.ts" }),
      started("editToolCall", { path: "src/a.ts" }),
      started("writeToolCall", { path: "docs/new.md" }),
    ];
    expect(touchedPaths(entries)).toEqual(["src/a.ts", "docs/new.md"]);
  });

  it("ignores search and listing tools, whose path is a directory", () => {
    const entries = [
      started("Glob", { path: "src" }),
      started("Grep", { path: "src", pattern: "x" }),
      started("lsToolCall", { path: "src" }),
      started("LS", { path: "." }),
    ];
    expect(touchedPaths(entries)).toEqual([]);
  });

  it("ignores shell calls, results, messages and tools without a usable path", () => {
    const entries = [
      started("Bash", { command: "cat src/a.ts" }),
      { kind: "tool_completed", payload: { tool: "Read", result: "x", callId: "c" } },
      { kind: "message", payload: { text: "src/a.ts" } },
      started("Read", undefined),
      started("Read", { path: "../escape.ts" }),
    ];
    expect(touchedPaths(entries)).toEqual([]);
  });

  it("lists each path once, in first-seen order", () => {
    const entries = [
      started("Read", { file_path: "b.ts" }),
      started("Edit", { file_path: "a.ts" }),
      started("Edit", { file_path: "b.ts" }),
    ];
    expect(touchedPaths(entries)).toEqual(["b.ts", "a.ts"]);
  });

  it("returns nothing for an empty timeline", () => {
    expect(touchedPaths([])).toEqual([]);
  });
});

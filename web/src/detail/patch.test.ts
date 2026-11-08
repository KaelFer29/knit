import { describe, expect, it } from "vitest";
import { parsePatch } from "./patch";

describe("parsePatch", () => {
  it("types each line and numbers old and new sides", () => {
    const lines = parsePatch("@@ -1,2 +1,3 @@\n one\n-two\n+TWO\n+three\n");
    expect(lines).toEqual([
      { kind: "hunk", text: "@@ -1,2 +1,3 @@" },
      { kind: "ctx", text: "one", oldNo: 1, newNo: 1 },
      { kind: "del", text: "two", oldNo: 2 },
      { kind: "add", text: "TWO", newNo: 2 },
      { kind: "add", text: "three", newNo: 3 },
    ]);
  });

  it("restarts numbering at every hunk and keeps the no-newline note", () => {
    const lines = parsePatch("@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file\n@@ -10 +10 @@\n-x\n+y\n");
    expect(lines.map((l) => l.kind)).toEqual(["hunk", "del", "add", "note", "hunk", "del", "add"]);
    expect(lines[5]).toMatchObject({ oldNo: 10 });
    expect(lines[6]).toMatchObject({ newNo: 10 });
  });

  it("keeps lines that look like markup as plain text", () => {
    expect(parsePatch("@@ -0,0 +1 @@\n+<img src=x onerror=alert(1)>\n")[1]).toEqual({ kind: "add", text: "<img src=x onerror=alert(1)>", newNo: 1 });
  });
});

import { describe, expect, it } from "vitest";
import { diffLines, isChanged, MAX_DIFF_CELLS, withContext } from "./diff";

const kinds = (a: string, b: string) => diffLines(a, b).map((l) => `${l.kind}:${l.text}`);

describe("diffLines", () => {
  it("marks equal text as unchanged", () => {
    expect(kinds("a\nb", "a\nb")).toEqual(["same:a", "same:b"]);
    expect(isChanged(diffLines("a\nb", "a\nb"))).toBe(false);
  });

  it("shows an added, a removed and a replaced line", () => {
    expect(kinds("a\nc", "a\nb\nc")).toEqual(["same:a", "add:b", "same:c"]);
    expect(kinds("a\nb\nc", "a\nc")).toEqual(["same:a", "del:b", "same:c"]);
    expect(kinds("a\nb\nc", "a\nx\nc")).toEqual(["same:a", "del:b", "add:x", "same:c"]);
  });

  it("numbers lines on both sides", () => {
    const lines = diffLines("a\nb", "a\nx\nb");
    expect(lines.map((l) => [l.oldNumber, l.newNumber])).toEqual([
      [1, 1],
      [undefined, 2],
      [2, 3],
    ]);
  });

  it("treats an empty side as no lines, and a final newline as a change", () => {
    expect(kinds("", "a")).toEqual(["add:a"]);
    expect(kinds("a", "")).toEqual(["del:a"]);
    expect(isChanged(diffLines("a", "a\n"))).toBe(true);
  });

  it("handles large files with a few edits quickly", () => {
    const a = Array.from({ length: 4000 }, (_, i) => `line ${i}`);
    const b = [...a];
    b[10] = "changed";
    b.splice(2000, 0, "inserted");
    const lines = diffLines(a.join("\n"), b.join("\n"));
    expect(lines.filter((l) => l.kind !== "same").length).toBe(3);
  });
});

describe("withContext", () => {
  it("keeps the lines around each change and folds the rest", () => {
    const a = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const b = a.replace("l10", "X");
    const items = withContext(diffLines(a, b), 2);
    expect(items.map((i) => (i.kind === "skip" ? `skip:${i.count}` : `${i.kind}:${i.text}`))).toEqual([
      "skip:8",
      "same:l8",
      "same:l9",
      "del:l10",
      "add:X",
      "same:l11",
      "same:l12",
      "skip:7",
    ]);
  });

  it("does not fold anything shorter than the context", () => {
    expect(withContext(diffLines("a\nb\nc", "a\nx\nc"), 3).some((i) => i.kind === "skip")).toBe(false);
  });
});

describe("diffLines on very large changes", () => {
  it("falls back to replacing the changed block, still correct and fast, instead of building a huge table", () => {
    const side = Math.ceil(Math.sqrt(MAX_DIFF_CELLS)) + 50;
    const old = ["first", ...Array.from({ length: side }, (_, i) => `old ${i}`), "last"].join("\n");
    const next = ["first", ...Array.from({ length: side }, (_, i) => `new ${i}`), "last"].join("\n");
    const started = Date.now();
    const lines = diffLines(old, next);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(lines.filter((l) => l.kind !== "add").map((l) => l.text).join("\n")).toBe(old);
    expect(lines.filter((l) => l.kind !== "del").map((l) => l.text).join("\n")).toBe(next);
    expect(lines[0]).toMatchObject({ kind: "same", text: "first" });
    expect(lines.at(-1)).toMatchObject({ kind: "same", text: "last" });
  });
});

describe("diffLines on large files with scattered edits", () => {
  it("reproduces both texts exactly and marks only the edited lines", () => {
    const old = Array.from({ length: 2500 }, (_, i) => `line ${i}`);
    const next = [...old];
    for (let k = 0; k < 40; k++) next[k * 61] = `changed ${k}`;
    next.splice(900, 0, "inserted a", "inserted b");
    next.splice(1700, 3);
    const lines = diffLines(old.join("\n"), next.join("\n"));
    expect(lines.filter((l) => l.kind !== "add").map((l) => l.text)).toEqual(old);
    expect(lines.filter((l) => l.kind !== "del").map((l) => l.text)).toEqual(next);
    expect(lines.filter((l) => l.kind !== "same").length).toBeLessThan(160);
    const same = lines.filter((l) => l.kind === "same");
    expect(same.every((l) => l.oldNumber !== undefined && l.newNumber !== undefined)).toBe(true);
  });
});

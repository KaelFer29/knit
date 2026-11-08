import { describe, expect, it } from "vitest";
import { checkScope } from "./check-scope.js";

describe("checkScope", () => {
  it("accepts exact files and reports nothing", () => {
    expect(checkScope(["src/a.ts"], ["src/a.ts", "src/b.ts"])).toEqual([]);
  });

  it("reports paths not in the allowed list, in input order", () => {
    expect(checkScope(["src/a.ts", "README.md", "x/y.ts"], ["src/a.ts"])).toEqual(["README.md", "x/y.ts"]);
  });

  it("treats a trailing slash as a directory prefix", () => {
    expect(checkScope(["src/deep/a.ts", "srcx/a.ts"], ["src/"])).toEqual(["srcx/a.ts"]);
  });

  it("supports * within one path segment", () => {
    expect(checkScope(["src/a.ts", "src/sub/b.ts"], ["src/*.ts"])).toEqual(["src/sub/b.ts"]);
  });

  it("supports ** across segments", () => {
    expect(checkScope(["src/a.ts", "src/sub/deep/b.ts", "lib/c.ts"], ["src/**/*.ts"])).toEqual(["lib/c.ts"]);
  });

  it("supports ? as a single non-slash character", () => {
    expect(checkScope(["a1.ts", "a12.ts", "a/.ts"], ["a?.ts"])).toEqual(["a12.ts", "a/.ts"]);
  });

  it("does not let regex metacharacters in patterns match other characters", () => {
    expect(checkScope(["a.ts", "axts"], ["a.ts"])).toEqual(["axts"]);
    expect(checkScope(["f(1).ts"], ["f(1).ts"])).toEqual([]);
  });

  it("flags every path when the allowed list is empty", () => {
    expect(checkScope(["a"], [])).toEqual(["a"]);
  });

  it("flags paths that escape the repository", () => {
    expect(checkScope(["../x.txt"], ["**"])).toEqual(["../x.txt"]);
  });
});

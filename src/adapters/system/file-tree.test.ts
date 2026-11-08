import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FileTreeError } from "../../core/ports/file-tree.js";
import { FsFileTree } from "./file-tree.js";

let base: string;
let root: string;
let outside: string;
const tree = new FsFileTree(100);

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "knit-file-tree-"));
  root = join(base, "repo");
  outside = join(base, "secret");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, ".git"));
  mkdirSync(outside);
  writeFileSync(join(root, "README.md"), "# hi\n");
  writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "bin.dat"), Buffer.from([1, 2, 0, 3]));
  writeFileSync(join(root, "big.txt"), "x".repeat(101));
  writeFileSync(join(root, ".git", "config"), "secret");
  writeFileSync(join(outside, "passwd"), "root");
  symlinkSync(outside, join(root, "escape-dir"));
  symlinkSync(join(outside, "passwd"), join(root, "escape-file"));
  symlinkSync(join(root, "README.md"), join(root, "inside-link"));
  mkdirSync(join(root, "vendor", "lib", ".git"), { recursive: true });
  writeFileSync(join(root, "vendor", "lib", ".git", "config"), "nested secret");
  writeFileSync(join(root, "vendor", "lib", "ok.txt"), "fine");
  symlinkSync(join(root, ".git"), join(root, "git-link"));
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return err instanceof FileTreeError ? err.code : "other";
  }
  return undefined;
};

describe("FsFileTree.list", () => {
  it("lists directories first, then files by name, without .git, and marks symlinks", () => {
    const listing = tree.list(root, "");
    expect(listing.path).toBe("");
    expect(listing.entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
      "directory:src",
      "directory:vendor",
      "file:README.md",
      "file:big.txt",
      "file:bin.dat",
      "symlink:escape-dir",
      "symlink:escape-file",
      "symlink:git-link",
      "symlink:inside-link",
    ]);
    expect(listing.entries.find((e) => e.name === "README.md")).toEqual({ name: "README.md", path: "README.md", kind: "file", size: 5 });
  });

  it("lists a subdirectory with paths relative to the root", () => {
    expect(tree.list(root, "src/").entries).toEqual([{ name: "a.ts", path: "src/a.ts", kind: "file", size: 20 }]);
  });

  it("rejects traversal, absolute paths, NUL, backslashes and .git", () => {
    for (const p of ["..", "../secret", "src/../../secret", "/etc", "a\0b", "src\\..", ".git", ".git/config"]) {
      expect(codeOf(() => tree.list(root, p)), p).toBe("outside");
    }
  });

  it("rejects a symlink that points out of the root", () => {
    expect(codeOf(() => tree.list(root, "escape-dir"))).toBe("outside");
  });

  it("reports a missing path and a file given as directory", () => {
    expect(codeOf(() => tree.list(root, "nope"))).toBe("not-found");
    expect(codeOf(() => tree.list(root, "README.md"))).toBe("not-directory");
    expect(codeOf(() => tree.list(join(base, "missing"), ""))).toBe("not-found");
  });
});

describe("FsFileTree.read", () => {
  it("returns the text of a file", () => {
    expect(tree.read(root, "src/a.ts")).toEqual({ kind: "text", path: "src/a.ts", size: 20, text: "export const a = 1;\n" });
  });

  it("follows a symlink that stays inside the root", () => {
    expect(tree.read(root, "inside-link")).toMatchObject({ kind: "text", text: "# hi\n" });
  });

  it("rejects a symlink that points out, traversal and .git", () => {
    expect(codeOf(() => tree.read(root, "escape-file"))).toBe("outside");
    expect(codeOf(() => tree.read(root, "../secret/passwd"))).toBe("outside");
    expect(codeOf(() => tree.read(root, ".git/config"))).toBe("outside");
    expect(codeOf(() => tree.read(root, "escape-dir/passwd"))).toBe("outside");
  });

  it("returns a marker, never bytes, for a binary file", () => {
    expect(tree.read(root, "bin.dat")).toEqual({ kind: "binary", path: "bin.dat", size: 4 });
  });

  it("returns a marker for a file above the size limit", () => {
    expect(tree.read(root, "big.txt")).toEqual({ kind: "too-large", path: "big.txt", size: 101, limit: 100 });
  });

  it("rejects a directory and a missing file", () => {
    expect(codeOf(() => tree.read(root, "src"))).toBe("not-file");
    expect(codeOf(() => tree.read(root, "nope.txt"))).toBe("not-found");
  });
});

describe("FsFileTree and the version-control directory", () => {
  it("rejects .git in any letter case and at any depth", () => {
    for (const p of [".GIT", ".Git/config", "vendor/lib/.git", "vendor/lib/.git/config", "vendor/lib/.GIT/config"]) {
      expect(codeOf(() => tree.read(root, p)), p).toBe("outside");
      expect(codeOf(() => tree.list(root, p)), p).toBe("outside");
    }
  });

  it("rejects a symlink that resolves into .git, for reading and listing", () => {
    expect(codeOf(() => tree.read(root, "git-link/config"))).toBe("outside");
    expect(codeOf(() => tree.list(root, "git-link"))).toBe("outside");
  });

  it("does not list a nested .git directory and still lists its siblings", () => {
    expect(tree.list(root, "vendor/lib").entries.map((e) => e.name)).toEqual(["ok.txt"]);
    expect(tree.read(root, "vendor/lib/ok.txt")).toMatchObject({ kind: "text", text: "fine" });
  });
});

describe("FsFileTree.read on something that is not a regular file", () => {
  it("refuses a FIFO without waiting for a writer", () => {
    execFileSync("mkfifo", [join(root, "pipe")]);
    expect(codeOf(() => tree.read(root, "pipe"))).toBe("not-file");
  });
});

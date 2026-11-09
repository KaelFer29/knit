import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ownsWorktree } from "./owns-worktree.js";

let scratch: string;
let runDir: string;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "knit-owns-"));
  runDir = join(scratch, "data", "worktrees", "run-1");
  mkdirSync(join(runDir, "T1", "repo"), { recursive: true });
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe("ownsWorktree", () => {
  it("owns a directory inside the run's directory", () => {
    expect(ownsWorktree(join(runDir, "T1", "repo"), runDir)).toBe(true);
  });

  it("does not own a directory outside it, or the run's directory itself", () => {
    mkdirSync(join(scratch, "elsewhere"));
    expect(ownsWorktree(join(scratch, "elsewhere"), runDir)).toBe(false);
    expect(ownsWorktree(runDir, runDir)).toBe(false);
  });

  it("does not follow `..` out of the run's directory", () => {
    mkdirSync(join(scratch, "elsewhere"));
    expect(ownsWorktree(join(runDir, "T1", "..", "..", "..", "..", "elsewhere"), runDir)).toBe(false);
  });

  it("does not own a symlink inside the run's directory that points outside it", () => {
    const outside = join(scratch, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "keep.txt"), "x");
    symlinkSync(outside, join(runDir, "T1", "link"));
    expect(ownsWorktree(join(runDir, "T1", "link"), runDir)).toBe(false);
  });

  it("owns nothing that does not exist", () => {
    expect(ownsWorktree(join(runDir, "T9", "repo"), runDir)).toBe(false);
    expect(ownsWorktree(join(runDir, "T1", "repo"), join(scratch, "no-such-run"))).toBe(false);
  });
});

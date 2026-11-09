import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLAN_DIR } from "../../core/ports/plan-drafts.js";
import { FsPlanDrafts } from "./plan-drafts.js";

const VALID = `# Plan: Add login

## T1: Form

Branch: feat/form
Goal: Build the form.
Specs:
- S1: It renders.
Allowed files:
- src/form.ts
Checks:
- pnpm test
`;

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "knit-drafts-"));
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

function put(file: string, text: string, mtime?: number): string {
  mkdirSync(join(repo, PLAN_DIR), { recursive: true });
  const path = join(repo, PLAN_DIR, file);
  writeFileSync(path, text);
  if (mtime) utimesSync(path, mtime, mtime);
  return path;
}

describe("FsPlanDrafts", () => {
  it("has no drafts when the directory is missing", () => {
    expect(new FsPlanDrafts().list(repo)).toEqual([]);
  });

  it("reports a valid plan with its tasks", () => {
    const path = put("login.md", VALID);
    const [draft] = new FsPlanDrafts().list(repo);
    expect(draft).toMatchObject({ path, file: "login.md", name: "Add login", valid: true, issues: [] });
    expect(draft!.tasks).toEqual([{ id: "T1", title: "Form", branch: "feat/form" }]);
  });

  it("carries the model a task names, so the draft shows what Cursor will use", () => {
    put("modeled.md", VALID.replace("Branch: feat/form\n", "Branch: feat/form\nModel: grok-4.7-high\n"));
    const [draft] = new FsPlanDrafts().list(repo);
    expect(draft!.tasks).toEqual([{ id: "T1", title: "Form", branch: "feat/form", model: "grok-4.7-high" }]);
  });

  it("reports the issues of an invalid plan and keeps the file name as its name", () => {
    put("bad.md", "# Plan: Broken\n\n## T1: Only a title\n");
    const [draft] = new FsPlanDrafts().list(repo);
    expect(draft!.valid).toBe(false);
    expect(draft!.name).toBe("bad.md");
    expect(draft!.issues.length).toBeGreaterThan(0);
    expect(draft!.tasks).toEqual([]);
  });

  it("lists newest first and only Markdown files", () => {
    put("old.md", VALID, 1_000_000);
    put("new.md", VALID, 2_000_000);
    put("notes.txt", "x");
    expect(new FsPlanDrafts().list(repo).map((d) => d.file)).toEqual(["new.md", "old.md"]);
  });

  it("ignores a symlink that leaves the directory", () => {
    const outside = mkdtempSync(join(tmpdir(), "knit-drafts-out-"));
    try {
      writeFileSync(join(outside, "x.md"), VALID);
      mkdirSync(join(repo, PLAN_DIR), { recursive: true });
      symlinkSync(join(outside, "x.md"), join(repo, PLAN_DIR, "link.md"));
      expect(new FsPlanDrafts().list(repo)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("marks a plan larger than the limit as invalid without parsing it", () => {
    put("huge.md", "a".repeat(1024 * 1024 + 1));
    const [draft] = new FsPlanDrafts().list(repo);
    expect(draft!.valid).toBe(false);
    expect(draft!.issues[0]).toMatch(/larger than/);
  });
});

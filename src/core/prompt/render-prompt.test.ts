import { describe, expect, it } from "vitest";
import { renderPrompt } from "./render-prompt.js";
import type { Task } from "../plan/parse-plan.js";

const TASK: Task = {
  id: "T1",
  title: "Add greeting",
  branch: "feat/add-greeting",
  goal: "Add a greet function.",
  specs: [
    { id: "S1", text: `"greet(name) returns 'Hello, <name>!'"` },
    { id: "S2", text: "Export it from src/index.ts" },
  ],
  allowedFiles: ["src/greet.ts", "src/index.ts"],
  checks: ["npm test"],
};

describe("renderPrompt", () => {
  it("renders task header, goal, specs verbatim and allowed files", () => {
    const p = renderPrompt(TASK);
    expect(p).toContain("Task: T1 - Add greeting");
    expect(p).toContain("Goal: Add a greet function.");
    expect(p).toContain(`- S1: "greet(name) returns 'Hello, <name>!'"`);
    expect(p).toContain("- S2: Export it from src/index.ts");
    expect(p).toContain("- src/greet.ts\n- src/index.ts");
  });

  it("tells the agent its branch and the git rules it must follow", () => {
    const p = renderPrompt(TASK);
    expect(p).toContain("You are on branch feat/add-greeting. Stay on it.");
    expect(p).toContain("Do not push");
    expect(p).toContain("Do not amend, rebase, reset");
    expect(p).toContain("grouped by sub-functionality");
    expect(p).toContain("type(scope): description");
    expect(p).toContain("single line with no body");
    expect(p).toContain("feat, fix, refactor, docs, chore, test");
    expect(p).toContain("Co-authored-by");
    expect(p).toContain("working tree clean");
  });

  it("lists git problems on retry", () => {
    const p = renderPrompt(TASK, { gitProblems: ["Uncommitted changes (commit them): a.ts"] });
    expect(p).toContain("Previous attempt failed.");
    expect(p).toContain("Git problems to fix:\n- Uncommitted changes (commit them): a.ts");
  });

  it("states the safety rules and the response language", () => {
    const p = renderPrompt(TASK);
    expect(p).toContain("Work only inside the current directory.");
    expect(p).toContain("Do not write outside the current directory.");
    expect(p).toContain("reply in English");
  });

  it("has no retry section and no unresolved placeholders on attempt 1", () => {
    const p = renderPrompt(TASK);
    expect(p).not.toContain("Previous attempt failed");
    expect(p).not.toMatch(/\{[a-z_]+\}/);
    expect(p.endsWith("\n")).toBe(true);
    expect(p.endsWith("\n\n")).toBe(false);
  });

  it("adds the failed check and the last 40 lines of its output on retry", () => {
    const output = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
    const p = renderPrompt(TASK, { failedCheck: "npm test", output });
    expect(p).toContain("Previous attempt failed.");
    expect(p).toContain("Failed check: npm test");
    expect(p).toContain("line 100");
    expect(p).toContain("line 61");
    expect(p).not.toContain("line 60\n");
  });

  it("reports a process failure on retry", () => {
    const p = renderPrompt(TASK, { processFailure: "No files were changed." });
    expect(p).toContain("Previous attempt failed.");
    expect(p).toContain("Problem: No files were changed.");
  });

  it("lists scope violations on retry", () => {
    const p = renderPrompt(TASK, { scopeViolations: ["README.md", "../x.txt"] });
    expect(p).toContain("Files changed outside the allowed list (revert them):");
    expect(p).toContain("- README.md\n- ../x.txt");
  });
});

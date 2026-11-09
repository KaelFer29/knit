import { describe, expect, it } from "vitest";
import { renderContinuationPrompt, renderFollowupPrompt, renderPrompt } from "./render-prompt.js";
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

describe("renderContinuationPrompt", () => {
  it("says what went wrong and nothing else about the task: the chat already holds the task, its specs and its rules", () => {
    const text = renderContinuationPrompt({ failedCheck: "npm test", output: "FAIL: expected 1 got 2" });
    expect(text).toContain("Failed check: npm test");
    expect(text).toContain("FAIL: expected 1 got 2");
    expect(text).toContain("unchanged");
    expect(text).not.toContain("You are the implementer");
    expect(text).not.toContain("Allowed files");
    expect(text).not.toContain("Git rules");
  });

  it("keeps the instruction to commit the work, and to reply the same way", () => {
    const text = renderContinuationPrompt({ processFailure: "The agent process failed" });
    expect(text).toMatch(/commit/i);
    expect(text).toMatch(/files changed/i);
    expect(text).toContain("Problem: The agent process failed");
  });

  it("is much shorter than the full prompt, which is the point", () => {
    const retry = { failedCheck: "npm test", output: "FAIL" };
    expect(renderContinuationPrompt(retry).length).toBeLessThan(renderPrompt(TASK, retry).length / 2);
  });
});


describe("renderFollowupPrompt", () => {
  it("keeps the instruction as typed and reminds the agent to commit on its branch", () => {
    const text = renderFollowupPrompt("  Add the date.  ", "docs/alpha");
    expect(text.startsWith("Add the date.\n")).toBe(true);
    expect(text).toContain("docs/alpha");
    expect(text).toMatch(/commit your work yourself/i);
    expect(text).toMatch(/working tree clean/i);
  });
});

import { describe, expect, it } from "vitest";
import { extractFollowup, iterationPrompt } from "./iterate";

const task = {
  taskId: "T1",
  title: "Create prueba.md",
  branch: "docs/one",
  goal: "Create a minimal document at the repository root.",
  specs: [
    { id: "S1", text: "The file is named prueba.md" },
    { id: "S2", text: "It says hello world" },
  ],
};

describe("iterationPrompt", () => {
  it("gives Claude the task it is about, on its branch and chat, and asks for the instruction in one followup block", () => {
    const text = iterationPrompt(task, "The heading is wrong, make it a level 2 heading");
    expect(text).toContain("Task T1: Create prueba.md");
    expect(text).toContain("Branch: docs/one");
    expect(text).toContain("Goal: Create a minimal document at the repository root.");
    expect(text).toContain("- S1: The file is named prueba.md");
    expect(text).toContain("- S2: It says hello world");
    expect(text).toMatch(/same branch/i);
    expect(text).toMatch(/do not (write a plan|change files)/i);
    expect(text).toContain("```followup");
  });

  it("puts the request last and untouched, so Claude reads the rules first", () => {
    const text = iterationPrompt(task, "  make it a level 2 heading  ");
    expect(text.trimEnd().endsWith("make it a level 2 heading")).toBe(true);
    expect(text.indexOf("Request")).toBeGreaterThan(text.indexOf("```followup"));
  });

  it("warns that the follow-up is checked against the task's own files", () => {
    expect(iterationPrompt(task, "x")).toMatch(/allowed files/i);
  });

  it("copes with a task that has no goal, no specs or no branch", () => {
    const text = iterationPrompt({ taskId: "T2", title: "Bare" }, "tweak it");
    expect(text).toContain("Task T2: Bare");
    expect(text).not.toContain("Goal:");
    expect(text).not.toContain("Specs:");
    expect(text).not.toContain("Branch:");
  });
});

describe("extractFollowup", () => {
  it("takes the text of the last fenced block labelled followup", () => {
    const answer = "Here you go.\n\n```followup\nMake the heading a level 2 heading.\n```\n\nAnything else?";
    expect(extractFollowup(answer)).toBe("Make the heading a level 2 heading.");
  });

  it("takes the last one when Claude wrote several, and keeps the inner lines", () => {
    const answer = "```followup\nfirst\n```\n\nOr better:\n\n```followup\nline one\n\nline three\n```";
    expect(extractFollowup(answer)).toBe("line one\n\nline three");
  });

  it("ignores blocks with another label, an empty block and an unclosed one", () => {
    expect(extractFollowup("```ts\nconst a = 1;\n```")).toBeUndefined();
    expect(extractFollowup("```followup\n\n```")).toBeUndefined();
    expect(extractFollowup("```followup\nnever closed")).toBeUndefined();
    expect(extractFollowup("no block at all")).toBeUndefined();
    expect(extractFollowup(undefined)).toBeUndefined();
  });

  it("reads Windows line endings and trims the ends", () => {
    expect(extractFollowup("```followup\r\n  fix it  \r\n```")).toBe("fix it");
  });

  it("does not read a followup block quoted inside another fence", () => {
    expect(extractFollowup("````md\n```followup\ninner\n```\n````")).toBeUndefined();
  });
});

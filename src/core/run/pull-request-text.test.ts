import { describe, expect, it } from "vitest";
import { prBody, prTitle } from "./pull-request-text.js";
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
  allowedFiles: ["src/greet.ts"],
  checks: ["npm test", "npm run lint"],
};

describe("pull request text", () => {
  it("builds the title from the branch type and the task title", () => {
    expect(prTitle(TASK)).toBe("feat: Add greeting");
    expect(prTitle({ ...TASK, branch: "docs/readme" })).toBe("docs: Add greeting");
  });

  it("lists goal, specs verbatim and checks in the body", () => {
    const body = prBody(TASK, "run-1");
    expect(body).toContain("## Goal\nAdd a greet function.");
    expect(body).toContain(`- S1: "greet(name) returns 'Hello, <name>!'"`);
    expect(body).toContain("- S2: Export it from src/index.ts");
    expect(body).toContain("- `npm test`\n- `npm run lint`");
    expect(body).toContain("Opened by Knit run run-1.");
  });

  it("says when there are no checks", () => {
    expect(prBody({ ...TASK, checks: [] }, "r")).toContain("## Checks\nNone");
  });
});

import { describe, expect, it } from "vitest";
import { checkGit } from "./check-git.js";
import type { GitInspection } from "../ports/workspace.js";

const OK: GitInspection = {
  branch: "feat/x",
  historyIntact: true,
  commits: [{ sha: "a".repeat(40), subject: "feat(core): add thing", body: "" }],
  uncommitted: [],
};

const check = (patch: Partial<GitInspection> = {}) => checkGit({ ...OK, ...patch }, "feat/x");

describe("checkGit", () => {
  it("accepts a clean inspection", () => {
    expect(check()).toEqual([]);
  });

  it("accepts every allowed type and scopeless subjects", () => {
    for (const subject of ["fix(ui): a", "refactor(core-api): a", "docs: a", "chore(x): a", "test(y): a"]) {
      expect(check({ commits: [{ sha: "b".repeat(40), subject, body: "" }] })).toEqual([]);
    }
  });

  it("flags a different branch", () => {
    expect(check({ branch: "main" })[0]).toContain("on branch 'main' instead of 'feat/x'");
  });

  it("flags rewritten history", () => {
    expect(check({ historyIntact: false })[0]).toContain("History was rewritten");
  });

  it.each(["added stuff", "Feat(core): x", "feat(Core): x", "feat(core1): x", "wip: x", "feat(core):", "feat(core):x"])(
    "flags invalid subject %s",
    (subject) => {
      const problems = check({ commits: [{ sha: "c".repeat(40), subject, body: "" }] });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("cccccccc");
      expect(problems[0]).toContain("invalid message");
    },
  );

  it("flags commits with a body or trailers", () => {
    const problems = check({
      commits: [{ sha: "d".repeat(40), subject: "feat(core): ok", body: "Co-authored-by: Someone <a@b.c>" }],
    });
    expect(problems[0]).toContain("has a body");
  });

  it("flags uncommitted changes and lists the paths", () => {
    expect(check({ uncommitted: ["a.ts", "b.ts"] })).toEqual(["Uncommitted changes (commit them): a.ts, b.ts"]);
  });

  it("reports several problems at once", () => {
    const problems = check({ branch: "x", uncommitted: ["a"], commits: [{ sha: "e".repeat(40), subject: "bad", body: "" }] });
    expect(problems).toHaveLength(3);
  });
});

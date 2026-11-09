import { describe, expect, it } from "vitest";
import { buildPrDraftPrompt, buildPrTemplate, parsePrDraft, prBaseOf } from "./pr-draft.js";

describe("prBaseOf", () => {
  const tasks = [
    { taskId: "T1", branch: "feat/one" },
    { taskId: "T2", branch: "feat/two", dependsOn: "T1" },
  ];

  it("targets the branch the run started from, read from the run's base", () => {
    expect(prBaseOf("main@a1b2c3d4", tasks[0]!, tasks)).toEqual({ ok: true, base: "main" });
    expect(prBaseOf("release/1.2@a1b2c3d4", tasks[0]!, tasks)).toEqual({ ok: true, base: "release/1.2" });
  });

  it("stacks on the parent's branch when the task depends on another", () => {
    expect(prBaseOf("main@a1b2c3d4", tasks[1]!, tasks)).toEqual({ ok: true, base: "feat/one", parent: { taskId: "T1", branch: "feat/one" } });
  });

  it("cannot target a base that was not a branch (a detached HEAD or a bare commit)", () => {
    for (const base of ["HEAD@a1b2c3d4", "a1b2c3d4", "", "@a1b2c3d4"]) {
      expect(prBaseOf(base, tasks[0]!, tasks)).toMatchObject({ ok: false, reason: expect.stringContaining("not a branch") });
    }
  });

  it("says so when the parent has no branch to stack on", () => {
    expect(prBaseOf("main@a1", { taskId: "T2", branch: "feat/two", dependsOn: "T1" }, [{ taskId: "T1" }])).toMatchObject({ ok: false, reason: expect.stringContaining("T1") });
  });
});

describe("buildPrDraftPrompt", () => {
  const input = {
    taskId: "T1",
    title: "Create prueba.md",
    goal: "Create a file named prueba.md.",
    specs: [{ id: "S1", text: "The file contains hello world" }],
    commits: [{ sha: "a", subject: "docs: add prueba.md" }],
    stat: " prueba.md | 1 +\n 1 file changed, 1 insertion(+)",
    patch: "diff --git a/prueba.md b/prueba.md\n+hello world\n",
    truncated: false,
  };

  it("gives the model the task, its specs, the commits and the change, and the output format", () => {
    const p = buildPrDraftPrompt(input);
    for (const part of ["Create prueba.md", "Create a file named prueba.md.", "S1: The file contains hello world", "docs: add prueba.md", "1 file changed", "+hello world", "Title:"]) {
      expect(p).toContain(part);
    }
  });

  it("forbids touching anything: the model only writes text", () => {
    expect(buildPrDraftPrompt(input)).toMatch(/do not (modify|change|edit|create)/i);
  });

  it("says when the change shown was cut", () => {
    expect(buildPrDraftPrompt({ ...input, truncated: true })).toMatch(/cut|truncated/i);
    expect(buildPrDraftPrompt(input)).not.toMatch(/was cut|truncated/i);
  });
});

describe("parsePrDraft", () => {
  it("reads the title from a Title: line and keeps the rest as the body", () => {
    expect(parsePrDraft("Title: Add prueba.md\n\n## Summary\n- adds the file\n", "T1")).toEqual({ title: "Add prueba.md", body: "## Summary\n- adds the file" });
  });

  it("falls back to the given title and the whole text when there is no Title: line", () => {
    expect(parsePrDraft("Just some text\nmore", "Create prueba.md")).toEqual({ title: "Create prueba.md", body: "Just some text\nmore" });
  });

  it("strips code fences and a leading label around the whole answer, and clips an endless title", () => {
    const fenced = parsePrDraft("```markdown\nTitle: Short\n\nBody\n```", "x");
    expect(fenced).toEqual({ title: "Short", body: "Body" });
    expect(parsePrDraft(`Title: ${"a".repeat(300)}\n\nb`, "x").title.length).toBe(100);
  });

  it("never returns an empty title", () => {
    expect(parsePrDraft("Title:   \n\nbody", "Fallback").title).toBe("Fallback");
    expect(parsePrDraft("", "Fallback")).toEqual({ title: "Fallback", body: "" });
  });
});

describe("buildPrTemplate", () => {
  const input = {
    taskId: "T1",
    title: "Create prueba.md",
    goal: "Create a minimal document at the repository root.",
    specs: [{ id: "S1", text: "The file is named prueba.md" }],
    commits: [{ sha: "b1", subject: "docs: add prueba.md" }, { sha: "b2", subject: "docs: fix the heading" }],
    stat: " prueba.md | 3 +++\n 1 file changed, 3 insertions(+)",
    patch: "diff --git a/prueba.md b/prueba.md",
    truncated: false,
  };

  it("uses the task's title and builds the same fixed sections every time, without a model", () => {
    const t = buildPrTemplate(input);
    expect(t.title).toBe("Create prueba.md");
    expect(t.body).toBe(
      [
        "## Summary",
        "Create a minimal document at the repository root.",
        "",
        "## Specs",
        "- S1: The file is named prueba.md",
        "",
        "## Changes",
        "- docs: add prueba.md",
        "- docs: fix the heading",
        "",
        "```",
        "prueba.md | 3 +++\n 1 file changed, 3 insertions(+)",
        "```",
        "",
        "## Verification",
        "Passed Knit's checks for T1: the agent process, the files it touched, git hygiene and the task's own checks.",
      ].join("\n"),
    );
  });

  it("falls back to the title when the task has no goal, and skips the Specs section when there are none", () => {
    const t = buildPrTemplate({ ...input, goal: undefined as never, specs: [] });
    expect(t.body).toContain("## Summary\nCreate prueba.md\n");
    expect(t.body).not.toContain("## Specs");
  });

  it("keeps a title to one line of at most 100 characters", () => {
    expect(buildPrTemplate({ ...input, title: "x".repeat(150) }).title).toHaveLength(100);
    expect(buildPrTemplate({ ...input, title: "a\nb" }).title).toBe("a b");
  });

  it("says when there are no file stats instead of printing an empty block", () => {
    expect(buildPrTemplate({ ...input, stat: "  " }).body).not.toContain("```");
  });
});

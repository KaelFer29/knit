import { describe, expect, it } from "vitest";
import { parsePlan, PlanParseError } from "./parse-plan.js";

const VALID = `# Plan: demo

Repo: /work/demo
Base: main

## T1: Add greeting

Branch: feat/add-greeting
Goal: Add a greet function.
Specs:
- S1: "greet(name) returns 'Hello, <name>!'"
- S2: Export it from src/index.ts
Allowed files:
- src/greet.ts
- \`src/index.ts\`
Checks:
- npm run lint
- npm test

## T2: Docs

Branch: docs/document-greet
Depends: T1
Goal: Document it.
Specs:
- S1: Mention greet in README.md
Allowed files:
- README.md
Checks:
`;

function issuesOf(md: string): string[] {
  try {
    parsePlan(md);
  } catch (e) {
    if (e instanceof PlanParseError) return e.issues;
    throw e;
  }
  return [];
}

describe("parsePlan", () => {
  it("parses a valid plan with header and tasks in file order", () => {
    const plan = parsePlan(VALID);
    expect(plan.name).toBe("demo");
    expect(plan.repo).toBe("/work/demo");
    expect(plan.base).toBe("main");
    expect(plan.tasks.map((t) => t.id)).toEqual(["T1", "T2"]);
  });

  it("parses task fields, keeping specs verbatim and stripping backticks from paths", () => {
    const t1 = parsePlan(VALID).tasks[0]!;
    expect(t1.title).toBe("Add greeting");
    expect(t1.goal).toBe("Add a greet function.");
    expect(t1.specs).toEqual([
      { id: "S1", text: `"greet(name) returns 'Hello, <name>!'"` },
      { id: "S2", text: "Export it from src/index.ts" },
    ]);
    expect(t1.allowedFiles).toEqual(["src/greet.ts", "src/index.ts"]);
    expect(t1.checks).toEqual(["npm run lint", "npm test"]);
  });

  it("accepts an empty Checks list and an omitted Base", () => {
    const plan = parsePlan(VALID.replace("Base: main\n", ""));
    expect(plan.base).toBeUndefined();
    expect(plan.tasks[1]!.checks).toEqual([]);
  });

  it("parses an optional Setup list from the plan header", () => {
    const md = VALID.replace("Base: main\n", "Base: main\nSetup:\n- pnpm install\n- `pnpm build`\n");
    expect(parsePlan(md).setup).toEqual(["pnpm install", "pnpm build"]);
  });

  it("defaults Setup to an empty list", () => {
    expect(parsePlan(VALID).setup).toEqual([]);
  });

  it("accepts a plan without Repo (the CLI resolves it from the current directory)", () => {
    expect(parsePlan(VALID.replace("Repo: /work/demo\n", "")).repo).toBeUndefined();
  });

  it("parses Branch and Depends", () => {
    const [t1, t2] = parsePlan(VALID).tasks;
    expect(t1).toMatchObject({ branch: "feat/add-greeting" });
    expect(t1!.dependsOn).toBeUndefined();
    expect(t2).toMatchObject({ branch: "docs/document-greet", dependsOn: "T1" });
  });

  it("rejects a task without Branch", () => {
    expect(issuesOf(VALID.replace("Branch: feat/add-greeting\n", ""))).toContain("T1: missing 'Branch:'");
  });

  it.each(["feature/x", "feat/", "feat/Upper", "feat/a b", "main", "feat/a..b", "feat/x.lock", "tests/x"])(
    "rejects invalid branch name %s",
    (b) => {
      const issues = issuesOf(VALID.replace("feat/add-greeting", b));
      expect(issues.some((i) => i.startsWith("T1: invalid branch name"))).toBe(true);
    },
  );

  it("accepts every conventional type as branch prefix", () => {
    for (const type of ["feat", "fix", "refactor", "docs", "chore", "test"]) {
      expect(parsePlan(VALID.replace("feat/add-greeting", `${type}/x-1.2`)).tasks[0]!.branch).toBe(`${type}/x-1.2`);
    }
  });

  it("rejects duplicate branches", () => {
    expect(issuesOf(VALID.replace("docs/document-greet", "feat/add-greeting"))).toContain(
      "Duplicate branch: feat/add-greeting",
    );
  });

  it("rejects Depends on an unknown or later task, on itself, or on several tasks", () => {
    expect(issuesOf(VALID.replace("Depends: T1", "Depends: T9"))).toContain("T2: Depends on unknown or later task T9");
    expect(issuesOf(VALID.replace("Depends: T1", "Depends: T2"))).toContain("T2: Depends on unknown or later task T2");
    expect(issuesOf(VALID.replace("Branch: feat/add-greeting\n", "Branch: feat/add-greeting\nDepends: T2\n"))).toContain(
      "T1: Depends on unknown or later task T2",
    );
    expect(issuesOf(VALID.replace("Depends: T1", "Depends: T1, T3"))).toContain("T2: Depends must name a single task");
  });

  it("rejects a plan without tasks", () => {
    expect(issuesOf("# Plan: x\n\nRepo: /r\n")).toContain("Plan has no tasks");
  });

  it("rejects duplicate task IDs", () => {
    expect(issuesOf(VALID.replace("## T2:", "## T1:"))).toContain("Duplicate task ID: T1");
  });

  it("rejects a task missing Goal, Specs or Allowed files", () => {
    const md = "# Plan: x\n\nRepo: /r\n\n## T1: Empty\n";
    const issues = issuesOf(md);
    expect(issues).toContain("T1: missing 'Goal:'");
    expect(issues).toContain("T1: missing Specs");
    expect(issues).toContain("T1: missing Allowed files");
  });

  it.each([".", "./", "/etc/passwd", "../outside", "src/../../x", "*", "**"])(
    "rejects unsafe allowed path %s",
    (p) => {
      const md = VALID.replace("- src/greet.ts", `- ${p}`);
      expect(issuesOf(md).some((i) => i.startsWith("T1: unsafe allowed path"))).toBe(true);
    },
  );

  it("collects every issue instead of stopping at the first", () => {
    const md = "# Plan: x\n\n## T1: A\n\n## T1: B\n";
    expect(issuesOf(md).length).toBeGreaterThan(3);
  });
});

describe("parsePlan: the model of a task", () => {
  const withModel = (line: string) => VALID.replace("Branch: feat/add-greeting\n", `Branch: feat/add-greeting\n${line}\n`);

  it("reads an optional Model per task, strips backticks and leaves it out when absent", () => {
    const plan = parsePlan(withModel("Model: `composer-2.5`"));
    expect(plan.tasks[0]!.model).toBe("composer-2.5");
    expect("model" in plan.tasks[1]!).toBe(false);
    expect("model" in parsePlan(VALID).tasks[0]!).toBe(false);
  });

  it("accepts the ids Cursor lists", () => {
    for (const id of ["auto", "composer-2.5", "grok-4.7-high", "gpt-5.3-codex-high-fast", "claude-sonnet-5-thinking-high", "cursor-grok-4.5-high"]) {
      expect(parsePlan(withModel(`Model: ${id}`)).tasks[0]!.model, id).toBe(id);
    }
  });

  it("accepts the parameterized ids the CLI takes: one bracket group of key=value pairs at the end", () => {
    for (const id of ["claude-opus-4-8[context=1m]", "claude-opus-4-8[context=1m,effort=high,fast=false]", "gpt-5[effort=high]", "m[]"]) {
      expect(parsePlan(withModel(`Model: ${id}`)).tasks[0]!.model, id).toBe(id);
    }
    expect(parsePlan(withModel("Model: `claude-opus-4-8[context=1m]`")).tasks[0]!.model).toBe("claude-opus-4-8[context=1m]");
  });

  it("rejects a bracket group that is open, nested, repeated, leading, followed by text or carries anything but key=value characters", () => {
    for (const bad of ["a[b", "a]b", "a[b]c", "[x]", "a[b][c]", "a[[b]]", "a[b c]", "a[b;c]", "a[$(x)]", "a[b`c]", "a[b\\c]", `a[${"x".repeat(81)}]`, "-a[b=c]"]) {
      expect(() => parsePlan(withModel(`Model: ${bad}`)), bad).toThrow(/T1: invalid model/);
    }
  });

  it("rejects a model that is empty, has spaces or could be read as a flag, and says which task", () => {
    for (const bad of ["Model:", "Model: Grok 4.7", "Model: --force", "Model: a;b", "Model: -x"]) {
      expect(() => parsePlan(withModel(bad)), bad).toThrow(/T1: invalid model/);
    }
  });

  it("is not read from the plan header, where it means nothing", () => {
    expect(() => parsePlan(VALID.replace("Base: main", "Base: main\nModel: auto"))).not.toThrow();
    expect(parsePlan(VALID.replace("Base: main", "Base: main\nModel: auto")).tasks.every((t) => !("model" in t))).toBe(true);
  });
});

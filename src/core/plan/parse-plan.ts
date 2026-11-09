export interface Spec {
  id: string;
  text: string;
}

export interface Task {
  id: string;
  title: string;
  /** Branch the agent works on, `type/slug` (gitflow). */
  branch: string;
  /** Task whose branch this one starts from; absent means it starts from the plan base. */
  dependsOn?: string;
  goal: string;
  /** Model the builder agent uses for this task (its `--model`); absent means the agent's own default. Chosen by the planner. */
  model?: string;
  specs: Spec[];
  allowedFiles: string[];
  checks: string[];
}

export interface Plan {
  name: string;
  /** Target repository; when absent the CLI uses the repository of the current directory. */
  repo?: string;
  base?: string;
  /** Commands run once in every fresh task worktree before the agent starts. */
  setup: string[];
  tasks: Task[];
}

/** A plan whose repository has been resolved to a concrete path. */
export type ResolvedPlan = Omit<Plan, "repo"> & { repo: string };

export class PlanParseError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid plan:\n- ${issues.join("\n- ")}`);
    this.name = "PlanParseError";
  }
}

type Section = "specs" | "allowed" | "checks" | null;

interface DraftTask {
  id: string;
  title: string;
  branch?: string;
  depends?: string;
  goal?: string;
  model?: string;
  specs: Spec[];
  allowedFiles: string[];
  checks: string[];
}

const TASK_HEADING = /^##\s+(T\d+):\s*(.*)$/;
const PLAN_HEADING = /^#\s+Plan:\s*(.*)$/;
const SPEC_ITEM = /^-\s+(S\d+):\s*(.*)$/;
/** The ids the Cursor CLI lists (`auto`, `composer-2.5`, `grok-4.7-high`): letters, digits and `. _ : / -`, never starting like a flag. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;

/** Whether `value` is a model id the agent CLIs take: one token, never starting like a flag. */
export function isModelId(value: string): boolean {
  return MODEL_ID.test(value);
}
const BRANCH_NAME = /^(feat|fix|refactor|docs|chore|test)\/[a-z0-9][a-z0-9._-]*$/;

function stripBackticks(value: string): string {
  const v = value.trim();
  return v.length >= 2 && v.startsWith("`") && v.endsWith("`") ? v.slice(1, -1).trim() : v;
}

function isUnsafePath(path: string): boolean {
  if (path === "" || path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return true;
  const segments = path.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.length === 0 || segments.includes("..")) return true;
  // A glob made only of wildcards would authorize the whole repo.
  return segments.every((s) => /^\*+$/.test(s));
}

function isValidBranch(name: string): boolean {
  return BRANCH_NAME.test(name) && !name.includes("..") && !name.endsWith(".") && !name.endsWith(".lock");
}

export function parsePlan(markdown: string): Plan {
  const issues: string[] = [];
  let name = "";
  let repo: string | undefined;
  let base: string | undefined;
  const setup: string[] = [];
  let inSetup = false;
  const drafts: DraftTask[] = [];
  let current: DraftTask | undefined;
  let section: Section = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.trim() === "") continue;

    const taskMatch = TASK_HEADING.exec(line);
    if (taskMatch) {
      current = { id: taskMatch[1]!, title: taskMatch[2]!.trim(), specs: [], allowedFiles: [], checks: [] };
      drafts.push(current);
      section = null;
      continue;
    }

    const planMatch = PLAN_HEADING.exec(line);
    if (planMatch && !current) {
      name = planMatch[1]!.trim();
      continue;
    }

    if (!current) {
      const header = /^(Repo|Base):\s*(.*)$/.exec(line);
      if (header) {
        inSetup = false;
        const value = stripBackticks(header[2]!);
        if (header[1] === "Repo") repo = value || undefined;
        else base = value || undefined;
      } else if (/^Setup:\s*$/.test(line)) {
        inSetup = true;
      } else if (inSetup && line.startsWith("-")) {
        setup.push(stripBackticks(line.replace(/^-\s*/, "")));
      }
      continue;
    }

    if (/^Goal:/.test(line)) {
      current.goal = line.slice("Goal:".length).trim();
      section = null;
    } else if (/^Branch:/.test(line)) {
      current.branch = stripBackticks(line.slice("Branch:".length));
      section = null;
    } else if (/^Model:/.test(line)) {
      current.model = stripBackticks(line.slice("Model:".length));
      section = null;
    } else if (/^Depends:/.test(line)) {
      current.depends = stripBackticks(line.slice("Depends:".length));
      section = null;
    } else if (/^Specs:\s*$/.test(line)) {
      section = "specs";
    } else if (/^Allowed files:\s*$/.test(line)) {
      section = "allowed";
    } else if (/^Checks:\s*$/.test(line)) {
      section = "checks";
    } else if (line.startsWith("-") && section) {
      const item = line.replace(/^-\s*/, "");
      if (section === "specs") {
        const spec = SPEC_ITEM.exec(line);
        if (spec) current.specs.push({ id: spec[1]!, text: spec[2]!.trim() });
        else issues.push(`${current.id}: malformed spec line: ${line.trim()}`);
      } else if (section === "allowed") {
        current.allowedFiles.push(stripBackticks(item));
      } else {
        current.checks.push(stripBackticks(item));
      }
    }
  }

  if (drafts.length === 0) issues.push("Plan has no tasks");

  const seen = new Set<string>();
  const branches = new Set<string>();
  for (const d of drafts) {
    if (seen.has(d.id)) issues.push(`Duplicate task ID: ${d.id}`);
    if (!d.goal) issues.push(`${d.id}: missing 'Goal:'`);
    if (d.model !== undefined && !MODEL_ID.test(d.model)) {
      issues.push(`${d.id}: invalid model '${d.model}' (use an id from 'agent models', such as auto or composer-2.5: no spaces, and it cannot start with a dash)`);
    }
    if (d.specs.length === 0) issues.push(`${d.id}: missing Specs`);
    if (d.allowedFiles.length === 0) issues.push(`${d.id}: missing Allowed files`);
    for (const p of d.allowedFiles) {
      if (isUnsafePath(p)) issues.push(`${d.id}: unsafe allowed path: ${p}`);
    }
    if (!d.branch) {
      issues.push(`${d.id}: missing 'Branch:'`);
    } else if (!isValidBranch(d.branch)) {
      issues.push(
        `${d.id}: invalid branch name '${d.branch}' (expected type/slug; type is one of feat, fix, refactor, docs, chore, test; slug uses lowercase letters, digits, dots and hyphens)`,
      );
    } else if (branches.has(d.branch)) {
      issues.push(`Duplicate branch: ${d.branch}`);
    } else {
      branches.add(d.branch);
    }
    if (d.depends !== undefined && d.depends !== "") {
      const deps = d.depends.split(",").map((x) => x.trim()).filter(Boolean);
      if (deps.length > 1) issues.push(`${d.id}: Depends must name a single task`);
      else if (deps.length === 1 && !seen.has(deps[0]!)) {
        issues.push(`${d.id}: Depends on unknown or later task ${deps[0]}`);
      }
    }
    seen.add(d.id);
  }

  if (issues.length > 0) throw new PlanParseError(issues);

  const tasks: Task[] = drafts.map((d) => {
    const dep = d.depends?.trim();
    return {
      id: d.id,
      title: d.title,
      branch: d.branch!,
      ...(dep ? { dependsOn: dep } : {}),
      goal: d.goal!,
      ...(d.model ? { model: d.model } : {}),
      specs: d.specs,
      allowedFiles: d.allowedFiles,
      checks: d.checks,
    };
  });

  return { name, ...(repo ? { repo } : {}), ...(base ? { base } : {}), setup, tasks };
}

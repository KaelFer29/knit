import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { SqliteRunStore } from "../../adapters/storage/sqlite/run-store.js";
import { parsePlan, PlanParseError, type Plan, type ResolvedPlan } from "../../core/plan/parse-plan.js";
import { UsageError } from "../errors.js";

/** Where the database, worktrees and logs live. */
/** File name of the SQLite database inside the data directory. */
export const DB_FILENAME = "knit.db";

export function dataDirOf(values: { "data-dir"?: string | undefined }, env: NodeJS.ProcessEnv): string {
  return resolve(values["data-dir"] ?? env.KNIT_HOME ?? join(env.HOME ?? homedir(), ".knit"));
}

export function openStoreIfExists(env: NodeJS.ProcessEnv, dataDirFlag?: string): SqliteRunStore | undefined {
  const dbPath = join(dataDirOf({ "data-dir": dataDirFlag }, env), DB_FILENAME);
  return existsSync(dbPath) ? new SqliteRunStore(dbPath) : undefined;
}

function gitToplevel(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new UsageError(
      "The plan has no 'Repo:' and the current directory is not inside a git repository. Run from the project or add 'Repo:' to the plan.",
    );
  }
}

/** Reads and validates a plan file and resolves its repository to a concrete path. */
export function loadPlan(planFile: string, env: NodeJS.ProcessEnv, cwd: string): { plan: ResolvedPlan; path: string } {
  const path = resolve(planFile);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new UsageError(`Cannot read plan ${path}: ${(err as Error).message}`);
  }
  let plan: Plan;
  try {
    plan = parsePlan(text);
  } catch (err) {
    if (err instanceof PlanParseError) throw new UsageError(err.message);
    throw err;
  }
  const home = env.HOME ?? homedir();
  let repo: string;
  if (plan.repo === undefined) repo = gitToplevel(cwd);
  else if (plan.repo.startsWith("~/")) repo = join(home, plan.repo.slice(2));
  else repo = resolve(dirname(path), plan.repo);
  return { plan: { ...plan, repo }, path };
}

export function makeRunId(planName: string, now: Date): string {
  const slug = planName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "plan";
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const rand = Math.random().toString(16).slice(2, 5);
  return `${slug}-${stamp}-${rand}`;
}

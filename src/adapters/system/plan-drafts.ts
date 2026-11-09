import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { parsePlan, PlanParseError } from "../../core/plan/parse-plan.js";
import { PLAN_DIR, type PlanDraft, type PlanDrafts } from "../../core/ports/plan-drafts.js";

/** Largest plan file that is parsed; the start route uses the same limit. */
export const MAX_DRAFT_BYTES = 1024 * 1024;
/** At most this many drafts are returned (newest first). */
export const MAX_DRAFTS = 20;

/** Reads the drafts of `<repo>/docs/plans` from the file system. Read-only; real files only, no symlinks. */
export class FsPlanDrafts implements PlanDrafts {
  list(repo: string): PlanDraft[] {
    let dir: string;
    let names: string[];
    try {
      dir = join(realpathSync(repo), PLAN_DIR);
      names = readdirSync(dir);
    } catch {
      return [];
    }
    const found: { draft: PlanDraft; mtimeMs: number }[] = [];
    for (const file of names) {
      if (!/\.md$/i.test(file)) continue;
      const path = join(dir, file);
      try {
        const stat = lstatSync(path);
        if (!stat.isFile()) continue;
        found.push({ draft: { ...inspect(path, file, stat.size), modifiedAt: stat.mtime.toISOString() }, mtimeMs: stat.mtimeMs });
      } catch {
        // Gone between the listing and the read.
      }
    }
    found.sort((a, b) => b.mtimeMs - a.mtimeMs || a.draft.file.localeCompare(b.draft.file));
    return found.slice(0, MAX_DRAFTS).map((f) => f.draft);
  }
}

function inspect(path: string, file: string, size: number): Omit<PlanDraft, "modifiedAt"> {
  const base = { path, file, name: file, valid: false, tasks: [] };
  if (size > MAX_DRAFT_BYTES) return { ...base, issues: [`Plan is larger than ${MAX_DRAFT_BYTES} bytes`] };
  try {
    const plan = parsePlan(readFileSync(path, "utf8"));
    return {
      ...base,
      name: plan.name,
      valid: true,
      issues: [],
      tasks: plan.tasks.map((t) => ({ id: t.id, title: t.title, branch: t.branch, ...(t.dependsOn ? { dependsOn: t.dependsOn } : {}) })),
    };
  } catch (err) {
    if (err instanceof PlanParseError) return { ...base, issues: err.issues };
    return { ...base, issues: ["Cannot read the plan"] };
  }
}

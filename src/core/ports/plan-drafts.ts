/**
 * Port: read-only detection of the draft plans a planning session left in a repository.
 *
 * A draft is a Markdown file in `PLAN_DIR` of the repository. An implementation validates each one with the same
 * parser `knit validate` and `knit run` use, so the result shown is the result a launch would get. It never writes.
 */

/** Where the `knit-plan` skill writes plans, relative to the repository the session runs in. One place, one constant. */
export const PLAN_DIR = "docs/plans";

export interface PlanDraftTask {
  id: string;
  title: string;
  branch: string;
  dependsOn?: string;
}

export interface PlanDraft {
  /** Absolute path of the file. */
  path: string;
  /** File name, for example `add-login.md`. */
  file: string;
  modifiedAt: string;
  /** The plan name when it parses; the file name otherwise. */
  name: string;
  valid: boolean;
  /** Every problem `knit validate` reports; empty when valid. */
  issues: string[];
  /** Present when the plan is valid. */
  tasks: PlanDraftTask[];
}

export interface PlanDrafts {
  /** Drafts under `<repo>/PLAN_DIR`, newest first. A repository without the directory has none. */
  list(repo: string): PlanDraft[];
}

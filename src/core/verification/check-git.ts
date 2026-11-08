import type { GitInspection } from "../ports/workspace.js";

/** `type(scope): description`; scope is optional and only lowercase letters and hyphens. */
export const COMMIT_SUBJECT = /^(feat|fix|refactor|docs|chore|test)(\([a-z-]+\))?: \S.*$/;

/**
 * Verifies the agent's git work against the project rules. Returns human-readable problems
 * (empty when everything is fine); they are fed back to the agent on retry.
 */
export function checkGit(inspection: GitInspection, expectedBranch: string): string[] {
  const problems: string[] = [];
  if (inspection.branch !== expectedBranch) {
    problems.push(`The worktree is on branch '${inspection.branch}' instead of '${expectedBranch}'; switch back to it.`);
  }
  if (!inspection.historyIntact) {
    problems.push(
      "History was rewritten: the starting commit is no longer an ancestor of HEAD. Do not amend, rebase or reset.",
    );
  }
  for (const commit of inspection.commits) {
    const short = commit.sha.slice(0, 8);
    if (!COMMIT_SUBJECT.test(commit.subject)) {
      problems.push(`Commit ${short} has an invalid message '${commit.subject}' (expected type(scope): description).`);
    }
    if (commit.body.trim() !== "") {
      problems.push(`Commit ${short} has a body or trailers; commit messages must be a single line.`);
    }
  }
  if (inspection.uncommitted.length > 0) {
    problems.push(`Uncommitted changes (commit them): ${inspection.uncommitted.join(", ")}`);
  }
  return problems;
}

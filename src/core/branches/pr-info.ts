import type { BranchInspector } from "../ports/branch-tools.js";
import type { PullRequestStatus } from "../ports/pull-requests.js";
import type { PriorPr } from "./pr-rules.js";

/**
 * What the pull request a task already has says about opening another: its state and, once it is merged or closed, how
 * many commits the branch has past the commit the pull request ended at (a follow-up adds them after the merge, so
 * they are not in the base). Nothing is counted while the pull request is open, nor without a commit to count from.
 */
export function priorPrOf(status: PullRequestStatus | undefined, inspector: Pick<BranchInspector, "commitsSince">, repo: string, branch: string): PriorPr | undefined {
  if (status === undefined) return undefined;
  if (status.state === "open" || status.headSha === undefined) return { state: status.state };
  const newCommits = inspector.commitsSince(repo, status.headSha, branch);
  return newCommits === undefined ? { state: status.state } : { state: status.state, newCommits };
}

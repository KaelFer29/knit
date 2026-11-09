export interface PullRequestStatus {
  state: "open" | "merged" | "closed";
  /** The branch the pull request targets. */
  base: string;
}

/** Port: opening pull requests on the code host. */
export interface CreatePullRequestInput {
  repo: string;
  /** Branch with the work. */
  head: string;
  /** Branch the PR targets (main, or the parent task's branch when stacked). */
  base: string;
  title: string;
  body: string;
}

export interface PullRequests {
  /** Throws a clear error if PRs cannot be opened (not logged in, no remote). */
  preflight(repo: string): void;
  /** Opens the PR, or returns the existing one for the same head branch. */
  create(input: CreatePullRequestInput): { url: string };
  /** Reads a pull request by its address: open, merged or closed, and the branch it targets. Throws when it cannot be read. */
  status(repo: string, url: string): PullRequestStatus;
}

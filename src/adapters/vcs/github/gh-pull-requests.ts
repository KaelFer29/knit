import { spawnSync } from "node:child_process";
import type { CreatePullRequestInput, PullRequestStatus, PullRequests } from "../../../core/ports/pull-requests.js";

export interface GhOptions {
  /** Binary to run. Default: `gh`. */
  command?: string;
  /** Arguments placed before the gh subcommand (used by tests to run a fake script). */
  prefixArgs?: string[];
  env?: Record<string, string>;
}

interface GhResult {
  status: number | null;
  stdout: string;
  stderr: string;
  missing: boolean;
}

/** Opens pull requests through the GitHub CLI. Credentials stay in `gh`; the agent never sees them. */
export class GhPullRequests implements PullRequests {
  private readonly command: string;
  private readonly prefixArgs: string[];
  private readonly env: Record<string, string>;

  constructor(options: GhOptions = {}) {
    this.command = options.command ?? "gh";
    this.prefixArgs = options.prefixArgs ?? [];
    this.env = options.env ?? {};
  }

  private gh(args: string[], cwd: string): GhResult {
    const r = spawnSync(this.command, [...this.prefixArgs, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, ...this.env },
    });
    const missing = (r.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", missing };
  }

  preflight(repo: string): void {
    const auth = this.gh(["auth", "status"], repo);
    if (auth.missing) throw new Error("GitHub CLI (gh) is not installed");
    if (auth.status !== 0) throw new Error("GitHub CLI is not logged in. Run: gh auth login");
    const remote = spawnSync("git", ["remote", "get-url", "origin"], { cwd: repo, encoding: "utf8" });
    if (remote.status !== 0) {
      throw new Error(`Repository ${repo} has no 'origin' remote; add one before using --push or --pr`);
    }
  }

  create(input: CreatePullRequestInput): { url: string } {
    const r = this.gh(
      ["pr", "create", "--head", input.head, "--base", input.base, "--title", input.title, "--body", input.body],
      input.repo,
    );
    if (r.status === 0) {
      const url = lastUrl(r.stdout);
      if (!url) throw new Error(`gh did not return a PR URL: ${r.stdout.trim()}`);
      return { url };
    }
    if (/already exists/i.test(r.stderr)) {
      const view = this.gh(["pr", "view", input.head, "--json", "url", "-q", ".url"], input.repo);
      const url = view.status === 0 ? lastUrl(view.stdout) : undefined;
      if (url) return { url };
    }
    throw new Error(`gh pr create failed: ${r.stderr.trim() || r.stdout.trim()}`);
  }

  status(repo: string, url: string): PullRequestStatus {
    const r = this.gh(["pr", "view", url, "--json", "state,baseRefName"], repo);
    if (r.status !== 0) throw new Error(`gh pr view failed: ${r.stderr.trim() || r.stdout.trim() || "no answer"}`);
    const parsed = JSON.parse(r.stdout) as { state?: string; baseRefName?: string };
    const state = parsed.state === "MERGED" ? "merged" : parsed.state === "CLOSED" ? "closed" : "open";
    return { state, base: parsed.baseRefName ?? "" };
  }
}

function lastUrl(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\/\S+$/.test(l))
    .at(-1);
}

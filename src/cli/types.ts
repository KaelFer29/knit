import type { AgentRunner } from "../core/ports/agent-runner.js";
import type { PullRequests } from "../core/ports/pull-requests.js";

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

export interface CliDeps {
  /** Builds the agent runner (override in tests). */
  agent?: (options: { command?: string; model?: string }) => AgentRunner;
  /** Pull request adapter (override in tests). Default: GitHub CLI. */
  pullRequests?: PullRequests;
  /** Extra git args for every git call (tests disable hooks with this). */
  gitArgs?: string[];
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
  /** Directory the command runs from (default: process.cwd()). */
  cwd?: string;
  /** Pause between polls of `logs --follow` (override in tests). */
  sleep?: (ms: number) => Promise<void>;
}

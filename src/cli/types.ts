import type { AgentRunner } from "../core/ports/agent-runner.js";
import type { ProcessControl } from "../core/ports/process-control.js";
import type { PullRequests } from "../core/ports/pull-requests.js";
import type { Spawner } from "../server/index.js";

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

export interface AgentOptions {
  command?: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  agent?: string;
}

export interface CliDeps {
  /**
   * Builds the agent runner (override in tests). `agent` names the agent (`claude` or `cursor`) and is set by `chat`
   * and `followup` (always `cursor`); `effort` and `permissionMode` are set by `chat` for Claude only. Plan runs
   * always use Cursor.
   */
  agent?: (options: AgentOptions) => AgentRunner;
  /** Process inspection and signalling used by `abort` and `ui` (override in tests). Default: the system adapter. */
  processControl?: ProcessControl;
  /** Starts `knit` child processes for the web interface's run control (override in tests). Default: detached children of this CLI. */
  spawnKnit?: Spawner;
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
  /** Ends a long-running command such as `ui` (default: SIGINT or SIGTERM). Tests abort it instead of signalling. */
  stopSignal?: AbortSignal;
}

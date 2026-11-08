/** Port: run one shell check (lint, tests, setup command) inside a worktree. */
export interface CheckResult {
  command: string;
  exitCode: number | null;
  /** Combined stdout and stderr (tail only if very large). */
  output: string;
  timedOut: boolean;
  durationMs: number;
}

export interface CheckRunner {
  run(command: string, cwd: string, timeoutMs: number): Promise<CheckResult>;
}

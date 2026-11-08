import type { CheckResult, CheckRunner } from "../../../core/ports/check-runner.js";
import { spawnWithTimeout } from "../../system/spawn-with-timeout.js";

export interface ShellCheckRunnerOptions {
  killGraceMs?: number;
  /** Max bytes of output kept (tail). Default 256 KiB. */
  maxOutputBytes?: number;
}

/** Runs checks with `bash -c`, stderr merged into stdout, in their own process group. */
export class ShellCheckRunner implements CheckRunner {
  constructor(private readonly options: ShellCheckRunnerOptions = {}) {}

  async run(command: string, cwd: string, timeoutMs: number): Promise<CheckResult> {
    const res = await spawnWithTimeout("bash", ["-c", `exec 2>&1\n${command}`], {
      cwd,
      timeoutMs,
      ...(this.options.killGraceMs !== undefined ? { killGraceMs: this.options.killGraceMs } : {}),
      ...(this.options.maxOutputBytes !== undefined ? { maxCaptureBytes: this.options.maxOutputBytes } : {}),
    });
    const output = res.spawnError ? `Could not start bash: ${res.spawnError}` : res.stdout;
    return { command, exitCode: res.exitCode, output, timedOut: res.timedOut, durationMs: res.durationMs };
  }
}

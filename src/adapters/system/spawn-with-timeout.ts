import { spawn } from "node:child_process";

export interface SpawnOptions {
  cwd: string;
  timeoutMs: number;
  /** Grace period between SIGTERM and SIGKILL on timeout. */
  killGraceMs?: number;
  /** Called for each complete stdout line as it arrives. */
  onStdoutLine?: (line: string) => void;
  /** Max bytes of stdout/stderr kept (the tail is kept). Default 256 KiB. */
  maxCaptureBytes?: number;
}

export interface SpawnResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  /** Set when the process could not be started (e.g. ENOENT). */
  spawnError?: string;
  durationMs: number;
}

/** Process groups currently running, so an abort can kill them instead of leaving orphans. */
const activeGroups = new Set<number>();

export function killActiveProcessGroups(signal: NodeJS.Signals = "SIGTERM"): void {
  for (const pid of activeGroups) {
    try {
      process.kill(-pid, signal);
    } catch {
      /* already gone */
    }
  }
}

function appendTail(current: string, chunk: string, max: number): string {
  const next = current + chunk;
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * Runs a command in its own process group so a timeout kills the whole tree.
 * stdin is closed. Never rejects: failures are reported in the result.
 */
export function spawnWithTimeout(command: string, args: string[], options: SpawnOptions): Promise<SpawnResult> {
  const { cwd, timeoutMs, killGraceMs = 5000, onStdoutLine, maxCaptureBytes = 256 * 1024 } = options;
  const started = Date.now();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    let timedOut = false;
    let settled = false;
    let timers: NodeJS.Timeout[] = [];

    const finish = (result: Omit<SpawnResult, "stdout" | "stderr" | "timedOut" | "durationMs">): void => {
      if (settled) return;
      settled = true;
      if (child.pid !== undefined) activeGroups.delete(child.pid);
      timers.forEach(clearTimeout);
      timers = [];
      if (lineBuffer && onStdoutLine) onStdoutLine(lineBuffer);
      resolve({ ...result, stdout, stderr, timedOut, durationMs: Date.now() - started });
    };

    const child = spawn(command, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });

    if (child.pid !== undefined) activeGroups.add(child.pid);

    const killGroup = (signal: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        /* already gone */
      }
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = appendTail(stdout, chunk, maxCaptureBytes);
      if (!onStdoutLine) return;
      lineBuffer += chunk;
      let idx: number;
      while ((idx = lineBuffer.indexOf("\n")) >= 0) {
        const line = lineBuffer.slice(0, idx);
        lineBuffer = lineBuffer.slice(idx + 1);
        if (line.trim() !== "") onStdoutLine(line);
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = appendTail(stderr, chunk, maxCaptureBytes);
    });

    child.on("error", (err) => finish({ exitCode: null, signal: null, spawnError: err.message }));
    child.on("close", (code, signal) => finish({ exitCode: code, signal }));

    timers.push(
      setTimeout(() => {
        timedOut = true;
        killGroup("SIGTERM");
        timers.push(
          setTimeout(() => {
            killGroup("SIGKILL");
            // Safety net: resolve even if the pipes never close.
            timers.push(setTimeout(() => finish({ exitCode: null, signal: "SIGKILL" }), 2000));
          }, killGraceMs),
        );
      }, timeoutMs),
    );
  });
}

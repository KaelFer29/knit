import type { SqliteRunStore } from "../../adapters/storage/sqlite/run-store.js";
import { SystemProcessControl } from "../../adapters/system/process-control.js";
import type { ProcessControl } from "../../core/ports/process-control.js";
import { UsageError } from "../errors.js";
import { parse, positiveNumber } from "../support/args.js";
import { DB_FILENAME, dataDirOf, openStoreIfExists } from "../support/paths.js";
import type { CliDeps, CliIo } from "../types.js";

const DEFAULT_GRACE_SECONDS = 10;
const POLL_MS = 50;
/** How long the SIGKILL escalation waits for the process to disappear before giving up. */
const KILL_WAIT_MS = 3000;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The command line of a Knit run: the program (`.../cli/index.js` or a `knit` binary) followed by `run`, or by
 * `resume <run-id>`. A `run` command line does not contain the run id, so the check cannot be tighter for it.
 */
export function knitRunMarker(runId: string): RegExp {
  const program = String.raw`(?:\S*[\\/]cli[\\/]index\.js|\S*[\\/]knit|knit)`;
  return new RegExp(String.raw`(?:^|\s)${program}\s+(?:run(?:\s|$)|resume\s+${escapeRegExp(runId)}(?:\s|$))`);
}

type AbortReason = "stale-pid" | "process-exited" | "killed-after-grace";

/** Marks a run that is still `running` as failed, clears its pid and records why. Returns false when it already finished. */
function markAborted(store: SqliteRunStore, runId: string, reason: AbortReason, now: Date, extra: object = {}): boolean {
  if (store.getRun(runId)?.run.status !== "running") return false;
  const ts = now.toISOString();
  store.finishRun(runId, "failed", ts);
  store.recordEvent({ runId, ts, type: "run.aborted", payload: { reason, ...extra } });
  return true;
}


const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitUntilGone(pc: ProcessControl, pid: number, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (pc.isAlive(pid)) {
    if (Date.now() >= end) return false;
    await sleep(POLL_MS);
  }
  return true;
}

/**
 * `knit abort <run-id>`: stops a running run. It sends SIGINT to the run's process, whose own handler kills the agent,
 * marks the run failed and records `run.aborted`; after the grace period it escalates to SIGKILL of the process group
 * and of the agents' groups. A run whose process is already gone (crash, `kill -9`) is marked failed here.
 * It never signals a process that is not verifiably a Knit run for this run id.
 */
export async function abortCommand(args: string[], io: CliIo, deps: CliDeps, env: NodeJS.ProcessEnv): Promise<number> {
  const { values, positionals } = parse(args, { "data-dir": { type: "string" }, "grace-seconds": { type: "string" } });
  if (positionals.length !== 1) throw new UsageError("abort needs exactly one run id");
  const runId = positionals[0]!;
  const graceMs = positiveNumber(values["grace-seconds"], "--grace-seconds", DEFAULT_GRACE_SECONDS) * 1000;
  const pc = deps.processControl ?? new SystemProcessControl();
  const now = deps.now ?? (() => new Date());

  const raw = openStoreIfExists(env, values["data-dir"]);
  if (!raw) {
    io.err(`Run not found: ${runId} (no database in ${dataDirOf({ "data-dir": values["data-dir"] }, env)}/${DB_FILENAME})\n`);
    return 1;
  }
  const store = raw;
  try {
    const detail = store.getRun(runId);
    if (!detail) {
      io.err(`Run not found: ${runId}\n`);
      return 1;
    }
    if (detail.run.status !== "running") {
      io.out(`Run ${runId} already finished (${detail.run.status}); nothing to abort.\n`);
      return 0;
    }
    const pid = detail.run.pid;
    if (pid === undefined) {
      io.err(
        `Run ${runId} is marked as running but has no recorded process (it started before pids were recorded), ` +
          `so it cannot be aborted safely. Nothing was changed.\n`,
      );
      return 1;
    }

    if (!pc.isAlive(pid)) {
      markAborted(store, runId, "stale-pid", now(), { pid });
      io.out(`Run ${runId} was marked as running but its process (pid ${pid}) is gone. Marked as failed.\n`);
      return 0;
    }
    if (!pc.commandMatches(pid, knitRunMarker(runId))) {
      io.err(
        `Pid ${pid} is alive but is not a Knit process for run ${runId} (the pid was probably reused). ` +
          `Nothing was signalled and nothing was changed.\n`,
      );
      return 1;
    }
    const sharing = store.listRuns().filter((r) => r.status === "running" && r.pid === pid && r.id !== runId);
    if (sharing.length > 0) {
      io.err(
        `Pid ${pid} is recorded for more than one running run (${[runId, ...sharing.map((r) => r.id)].join(", ")}), ` +
          `so it is unclear which one it executes. Nothing was signalled and nothing was changed.\n`,
      );
      return 1;
    }

    // Cooperative stop first: the run's handler kills the agent's groups and records the abort itself.
    pc.signal(pid, "SIGINT");
    if (await waitUntilGone(pc, pid, graceMs)) {
      if (markAborted(store, runId, "process-exited", now(), { pid })) {
        io.out(`Run ${runId} stopped, but its process exited without recording the abort. Marked as failed.\n`);
      } else {
        io.out(`Run ${runId} aborted.\n`);
      }
      return 0;
    }

    // Grace period over: kill what is left. Collect the agents' groups before the parent disappears.
    const agentGroups = pc.descendantGroups(pid);
    if (pc.processGroupOf(pid) === pid) pc.signalGroup(pid, "SIGKILL");
    else pc.signal(pid, "SIGKILL");
    for (const group of agentGroups) pc.signalGroup(group, "SIGKILL");
    if (!(await waitUntilGone(pc, pid, KILL_WAIT_MS))) {
      io.err(`Run ${runId}: process ${pid} did not exit after SIGKILL. The run was left as it is.\n`);
      return 1;
    }
    markAborted(store, runId, "killed-after-grace", now(), { pid, graceSeconds: graceMs / 1000 });
    io.out(`Run ${runId} did not stop within ${graceMs / 1000}s and was killed. Marked as failed.\n`);
    return 0;
  } finally {
    store.close();
  }
}

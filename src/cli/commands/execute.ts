import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CursorAgentRunner } from "../../adapters/agents/cursor/cursor-runner.js";
import { ShellCheckRunner } from "../../adapters/checks/shell/shell-check-runner.js";
import { FileTranscriptStore } from "../../adapters/storage/files/file-transcript-store.js";
import { SqliteRunStore } from "../../adapters/storage/sqlite/run-store.js";
import { killActiveProcessGroups } from "../../adapters/system/spawn-with-timeout.js";
import { GitWorkspace } from "../../adapters/vcs/git/git-workspace.js";
import { GhPullRequests } from "../../adapters/vcs/github/gh-pull-requests.js";
import type { ResolvedPlan } from "../../core/plan/parse-plan.js";
import { runPlan } from "../../core/run/run-plan.js";
import { PROGRAM_NAME } from "../usage.js";
import { positiveNumber, type RunValues } from "../support/args.js";
import { formatProgress } from "../support/format.js";
import { DB_FILENAME, dataDirOf, makeRunId } from "../support/paths.js";
import type { CliDeps, CliIo } from "../types.js";

/** Shared by `run` and `resume`: wires the adapters, runs the plan and reports the outcome. */
export async function execute(
  plan: ResolvedPlan,
  planPath: string,
  values: RunValues,
  io: CliIo,
  deps: CliDeps,
  env: NodeJS.ProcessEnv,
  resumeRunId: string | undefined,
): Promise<number> {
  const maxAttempts = positiveNumber(values["max-attempts"], "--max-attempts", 2);
  const agentTimeoutMs = positiveNumber(values["agent-timeout-min"], "--agent-timeout-min", 10) * 60_000;
  const checkTimeoutMs = positiveNumber(values["check-timeout-min"], "--check-timeout-min", 5) * 60_000;

  const dataDir = dataDirOf(values, env);
  mkdirSync(dataDir, { recursive: true });
  const store = new SqliteRunStore(join(dataDir, DB_FILENAME));
  const workspace = new GitWorkspace({
    root: join(dataDir, "worktrees"),
    ...(deps.gitArgs ? { gitArgs: deps.gitArgs } : {}),
  });
  const agentOptions = {
    ...(values["agent-command"] ? { command: values["agent-command"] } : {}),
    ...(values.model ? { model: values.model } : {}),
  };
  const agent = deps.agent ? deps.agent(agentOptions) : new CursorAgentRunner(agentOptions);
  const now = deps.now ?? (() => new Date());
  const runId = resumeRunId ?? makeRunId(plan.name, now());

  const onSignal = (): void => {
    killActiveProcessGroups("SIGKILL");
    try {
      store.finishRun(runId, "failed", now().toISOString());
      store.recordEvent({ runId, ts: now().toISOString(), type: "run.aborted" });
    } catch {
      /* best effort */
    }
    io.err(`\nAborted. Run ${runId} marked as failed.\n`);
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    const summary = await runPlan(
      plan,
      {
        agent,
        checks: new ShellCheckRunner(),
        workspace,
        store,
        pullRequests: deps.pullRequests ?? new GhPullRequests(),
        transcripts: new FileTranscriptStore(join(dataDir, "logs")),
        now,
        onProgress: (e) => {
          const line = formatProgress(e);
          if (line) io.out(`${line}\n`);
        },
      },
      {
        runId,
        planPath,
        maxAttempts,
        agentTimeoutMs,
        checkTimeoutMs,
        ...(values.push ? { push: true } : {}),
        ...(values.pr ? { pr: true } : {}),
        ...(resumeRunId ? { resume: true } : {}),
      },
    );
    io.out(`\nRun ${runId}: ${summary.status}\n`);
    for (const t of summary.tasks) {
      const bits = [t.reused ? "(already done)" : "", t.prUrl ? `PR ${t.prUrl}` : "", t.reason ? `- ${t.reason}` : ""]
        .filter(Boolean)
        .join(" ");
      io.out(`  ${t.taskId} ${t.status}${bits ? ` ${bits}` : ""}\n`);
    }
    for (const w of summary.warnings) io.out(`WARNING: ${w}\n`);
    io.out(`Details: ${PROGRAM_NAME} show ${runId}\n`);
    if (summary.status === "failed") io.out(`After fixing the cause: ${PROGRAM_NAME} resume ${runId}\n`);
    return summary.status === "passed" ? 0 : 1;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    store.close();
  }
}

import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FsPlanDrafts } from "../../adapters/system/plan-drafts.js";
import { FsFileTree } from "../../adapters/system/file-tree.js";
import { GitBranchTools } from "../../adapters/vcs/git/git-branch-tools.js";
import { GitTaskDiff } from "../../adapters/vcs/git/task-diff.js";
import { GitFileActivity } from "../../adapters/vcs/git/file-activity.js";
import { SqliteRunReader } from "../../adapters/storage/sqlite/run-reader.js";
import { FileConfigFiles } from "../../adapters/system/config-files.js";
import { useConfigFiles } from "../../server/routes/config.js";
import { ClaudeAgentRunner } from "../../adapters/agents/claude/claude-runner.js";
import { CursorAgentRunner } from "../../adapters/agents/cursor/cursor-runner.js";
import { SqliteSessionReader } from "../../adapters/storage/sqlite/session-reader.js";
import { capabilitiesOf, type AgentRunner } from "../../core/ports/agent-runner.js";
import { lazyRunReader, PortInUseError, startServer, type ControlDeps, type Spawner } from "../../server/index.js";
import { lazySessionReader } from "../../server/routes/sessions.js";
import type { AgentInfo } from "../../server/types.js";
import { UsageError } from "../errors.js";
import { parse } from "../support/args.js";
import { DB_FILENAME, dataDirOf } from "../support/paths.js";
import type { CliDeps, CliIo } from "../types.js";

const DEFAULT_PORT = 4317;

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n > 65535) throw new UsageError(`--port must be a whole number from 0 to 65535, got '${raw}'`);
  return n;
}

/** Variables that could carry a launch token. The token is never put in the environment, so this only guards against one the user exported. */
const TOKEN_VARIABLES = ["KNIT_UI_TOKEN", "KNIT_TOKEN"];

export interface KnitSpawnerOptions {
  /** The CLI entry point (`dist/cli/index.js`) the children run with the current Node. */
  entry: string;
  /** Environment of the children; the token variables are removed. */
  env: NodeJS.ProcessEnv;
  /** Extra arguments for `run` and `resume` children only (for example `--agent-command`); `abort` does not accept them. */
  runArgs?: string[];
}

/**
 * The spawner behind the web interface's run control: each child is `node <entry> <args>` in its own process group
 * (so `knit abort` can signal it and it survives the server), with stdin closed and stdout and stderr appended to the
 * log file. The pid it reports is the pid of the Knit process itself, which is what the run records in the database.
 */
export function knitSpawner({ entry, env, runArgs = [] }: KnitSpawnerOptions): Spawner {
  const childEnv = { ...env };
  for (const name of TOKEN_VARIABLES) delete childEnv[name];
  return ({ args, cwd, logFile }) => {
    mkdirSync(dirname(logFile), { recursive: true });
    const fd = openSync(logFile, "a");
    try {
      const withRunArgs = args[0] === "run" || args[0] === "resume" ? [...args, ...runArgs] : args;
      const child = spawn(process.execPath, [entry, ...withRunArgs], {
        ...(cwd ? { cwd } : {}),
        detached: true,
        stdio: ["ignore", fd, fd],
        env: childEnv,
      });
      const exited = new Promise<number | null>((resolve) => {
        child.once("exit", (code) => resolve(code));
        child.once("error", () => resolve(null));
      });
      child.unref();
      return { pid: child.pid, exited };
    } finally {
      closeSync(fd);
    }
  };
}

/**
 * The agents the interface offers, built here because only the composition root knows the adapters. The server and the
 * page work from what each one declares (capabilities, profile fields, models), never from its name.
 */
export function agentInfos(build: (agent: string) => AgentRunner): AgentInfo[] {
  const describe = (id: string, label: string, profileFields: AgentInfo["profileFields"], binary: string): AgentInfo => {
    const runner = build(id);
    return {
      id,
      label,
      capabilities: capabilitiesOf(runner),
      profileFields,
      ...(runner.listModels ? { listModels: () => runner.listModels!() } : {}),
      ...(runner.readPlanUsage ? { readPlanUsage: () => runner.readPlanUsage!() } : {}),
      resumeCommand: (agentSessionId) => `${binary} --resume ${agentSessionId}`,
    };
  };
  return [describe("claude", "Claude", ["model", "effort", "permissionMode"], "claude"), describe("cursor", "Cursor", ["model"], "agent")];
}

/** Run control needs the compiled CLI to start children from; a source checkout without a build has none, and the server is then read-only. */
function controlFor(
  dataDir: string,
  env: NodeJS.ProcessEnv,
  injected: Spawner | undefined,
  sessions: ControlDeps["sessions"],
): ControlDeps | undefined {
  if (injected) return { dataDir, spawn: injected, sessions };
  const entry = fileURLToPath(new URL("../index.js", import.meta.url));
  if (!existsSync(entry)) return undefined;
  return { dataDir, spawn: knitSpawner({ entry, env: { ...process.env, ...env } }), sessions };
}

/** Resolves when SIGINT or SIGTERM arrives (or when `signal` aborts, which tests use instead). */
function waitForStop(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = (): void => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    signal?.addEventListener("abort", done);
    if (!signal) {
      process.once("SIGINT", done);
      process.once("SIGTERM", done);
    }
  });
}

/**
 * Serves the web interface on 127.0.0.1 until interrupted. The database is opened read-only, and only once it exists:
 * a first launch before any run shows an empty list and picks the database up when `knit run` creates it.
 * It prints the launch URL, which carries the per-launch token, and never opens a browser.
 */
export async function uiCommand(args: string[], io: CliIo, deps: CliDeps, env: NodeJS.ProcessEnv): Promise<number> {
  const { values } = parse(args, { port: { type: "string" }, "data-dir": { type: "string" } }, false);
  const port = parsePort(values.port);
  const dataDir = dataDirOf({ "data-dir": values["data-dir"] }, env);
  const dbPath = join(dataDir, DB_FILENAME);
  // The configuration editor edits the project `knit ui` was started in and the user's home; backups go to the data dir.
  useConfigFiles(
    new FileConfigFiles({
      projectDir: resolve(deps.cwd ?? process.cwd()),
      homeDir: env.HOME ?? homedir(),
      backupDir: join(dataDir, "config-backups"),
    }),
  );
  const sessionReader = lazySessionReader(() => (existsSync(dbPath) ? new SqliteSessionReader(dbPath) : undefined));
  const build = (agent: string): AgentRunner => (deps.agent ? deps.agent({ agent }) : agent === "cursor" ? new CursorAgentRunner() : new ClaudeAgentRunner());
  const control = controlFor(dataDir, env, deps.spawnKnit, { reader: sessionReader, agents: agentInfos(build) });
  const reader = lazyRunReader(() => (existsSync(dbPath) ? new SqliteRunReader(dbPath) : undefined));

  let server;
  try {
    server = await startServer({
      reader,
      port,
      files: new FsFileTree(),
      plans: new FsPlanDrafts(),
      taskDiff: deps.taskDiff ?? new GitTaskDiff(),
      branches: new GitBranchTools(deps.gitArgs ? { gitArgs: deps.gitArgs } : {}),
      fileActivity: deps.fileActivity ?? new GitFileActivity(),
      ...(control ? { control } : {}),
    });
  } catch (err) {
    reader.close();
    useConfigFiles(undefined);
    sessionReader.close();
    if (err instanceof PortInUseError) {
      io.err(`Port ${err.port} is already in use. Stop the other process, pick another with --port <n>, or use --port 0 for a free one.\n`);
      return 1;
    }
    throw err;
  }

  io.out(`${server.url}\n`);
  io.err("Open the address above in your browser. Press Ctrl+C to stop.\n");
  await waitForStop(deps.stopSignal);
  await server.close();
  reader.close();
  useConfigFiles(undefined);
  sessionReader.close();
  return 0;
}

import { mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { ClaudeAgentRunner } from "../../adapters/agents/claude/claude-runner.js";
import { CursorAgentRunner } from "../../adapters/agents/cursor/cursor-runner.js";
import type { StoredAgentEvent } from "../../adapters/storage/sqlite/run-store.js";
import { SqliteSessionStore } from "../../adapters/storage/sqlite/session-store.js";
import { killActiveProcessGroups } from "../../adapters/system/spawn-with-timeout.js";
import { runTurn, titleFromPrompt } from "../../core/chat/index.js";
import type { AgentProfile, AgentRunner } from "../../core/ports/agent-runner.js";
import type { SessionEventRecord, TurnRecord } from "../../core/ports/session-store.js";
import { UsageError } from "../errors.js";
import { parse } from "../support/args.js";
import { formatAgentEvent } from "../support/format.js";
import { DB_FILENAME, dataDirOf, makeSessionId } from "../support/paths.js";
import type { AgentOptions, CliDeps, CliIo } from "../types.js";
import { PROGRAM_NAME } from "../usage.js";

const AGENTS = ["claude", "cursor"] as const;
const DEFAULT_AGENT = "claude";
/** A planning turn can read a lot of code; this only stops a turn that hangs for good. */
const TURN_TIMEOUT_MS = 30 * 60_000;

const OPTIONS = {
  agent: { type: "string" },
  session: { type: "string" },
  cwd: { type: "string" },
  model: { type: "string" },
  effort: { type: "string" },
  "permission-mode": { type: "string" },
  "agent-command": { type: "string" },
  "data-dir": { type: "string" },
} as const;

function buildAgent(deps: CliDeps, options: AgentOptions): AgentRunner {
  if (deps.agent) return deps.agent(options);
  const { agent, effort, permissionMode, ...common } = options;
  return agent === "cursor" ? new CursorAgentRunner(common) : new ClaudeAgentRunner({ ...common, ...(effort ? { effort } : {}), ...(permissionMode ? { permissionMode } : {}) });
}

/** The line `knit logs` would print for a timeline entry, without its `[run]` label (a chat has no tasks). */
function formatEntry(e: SessionEventRecord): string {
  const stored: StoredAgentEvent = { id: 0, runId: e.sessionId, ts: e.ts, kind: e.kind, agent: e.agent, ...(e.payload !== undefined ? { payload: e.payload } : {}) };
  return formatAgentEvent(stored).replace(" [run] ", " ");
}

function directoryOf(path: string): string {
  try {
    if (statSync(path).isDirectory()) return path;
  } catch {
    /* reported below */
  }
  throw new UsageError(`--cwd is not a directory: ${path}`);
}

/**
 * Runs ONE turn of an agent and records it as part of a session. Without `--session` it starts a new session in
 * `--cwd`; with it, the turn continues that session (the agent resumes its own conversation).
 */
export async function chatCommand(args: string[], io: CliIo, deps: CliDeps, env: NodeJS.ProcessEnv, cwd: string): Promise<number> {
  const { values, positionals } = parse(args, OPTIONS);
  if (positionals.length !== 1 || positionals[0]!.trim() === "") throw new UsageError("chat needs exactly one prompt");
  const prompt = positionals[0]!;
  if (values.agent !== undefined && !(AGENTS as readonly string[]).includes(values.agent)) {
    throw new UsageError(`--agent must be one of ${AGENTS.join(", ")}, got '${values.agent}'`);
  }

  const dataDir = dataDirOf(values, env);
  mkdirSync(dataDir, { recursive: true });
  const store = new SqliteSessionStore(join(dataDir, DB_FILENAME));
  const now = deps.now ?? (() => new Date());
  let turn: TurnRecord | undefined;
  let signalled = false;

  const onSignal = (): void => {
    if (signalled) return;
    signalled = true;
    killActiveProcessGroups("SIGKILL");
    try {
      if (turn) store.finishTurn(turn.id, { status: "failed", finishedAt: now().toISOString(), resultText: "Aborted" });
    } catch {
      /* best effort */
    }
    io.err(`\nAborted. Turn marked as failed.${turn ? ` Session: ${turn.sessionId}` : ""}\n`);
    process.exit(130);
  };

  try {
    let sessionId = values.session;
    let agentName: string;
    let sessionCwd: string;
    if (sessionId !== undefined) {
      const session = store.getSession(sessionId);
      if (!session) {
        io.err(`Session not found: ${sessionId}\n`);
        return 1;
      }
      if (values.agent !== undefined && values.agent !== session.agent) {
        throw new UsageError(`Session ${session.id} belongs to ${session.agent}; --agent ${values.agent} does not match`);
      }
      if (values.cwd !== undefined && resolve(cwd, values.cwd) !== session.cwd) {
        throw new UsageError(`Session ${session.id} runs in ${session.cwd}; --cwd ${values.cwd} does not match. Omit --cwd to continue it.`);
      }
      agentName = session.agent;
      sessionCwd = session.cwd;
    } else {
      agentName = values.agent ?? DEFAULT_AGENT;
      sessionCwd = directoryOf(resolve(cwd, values.cwd ?? "."));
    }
    if (agentName === "cursor" && (values.effort !== undefined || values["permission-mode"] !== undefined)) {
      throw new UsageError("--effort and --permission-mode apply to Claude only; Cursor does not take them");
    }

    const profile: AgentProfile = {
      ...(values.model ? { model: values.model } : {}),
      ...(values.effort ? { effort: values.effort } : {}),
      ...(values["permission-mode"] ? { permissionMode: values["permission-mode"] } : {}),
    };
    const agent = buildAgent(deps, {
      agent: agentName,
      ...(values["agent-command"] ? { command: values["agent-command"] } : {}),
      ...(profile.model ? { model: profile.model } : {}),
      ...(profile.effort ? { effort: profile.effort } : {}),
      ...(profile.permissionMode ? { permissionMode: profile.permissionMode } : {}),
    });

    if (sessionId === undefined) {
      sessionId = makeSessionId(now());
      store.createSession({ id: sessionId, agent: agentName, title: titleFromPrompt(prompt), cwd: sessionCwd, createdAt: now().toISOString() });
    }

    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    const summary = await runTurn(
      { agent, store, now },
      {
        sessionId,
        prompt,
        timeoutMs: TURN_TIMEOUT_MS,
        pid: process.pid,
        ...(Object.keys(profile).length > 0 ? { profile } : {}),
        onTurnStart: (t) => {
          turn = t;
        },
        onEvent: (e) => io.out(`${formatEntry(e)}\n`),
      },
    );

    if (summary.passed) io.out(`\n${summary.result.resultText}\n`);
    else io.err(`\nTurn failed: ${summary.result.resultText}\n`);
    io.out(`\nSession: ${sessionId}\n`);
    io.out(`Continue: ${PROGRAM_NAME} chat --session ${sessionId} "<prompt>"\n`);
    return summary.passed ? 0 : 1;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    store.close();
  }
}

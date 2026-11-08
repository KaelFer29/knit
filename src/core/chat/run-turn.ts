import { capabilitiesOf, type AgentProfile, type AgentRunResult, type AgentRunner } from "../ports/agent-runner.js";
import type { SessionEventRecord, SessionRecord, SessionStore, TurnRecord } from "../ports/session-store.js";
import { AgentEventNormalizer, type AgentLogEntry } from "../timeline/normalize-agent-events.js";
import { ClaudeEventNormalizer } from "../timeline/normalize-claude-events.js";

/** A problem with the request itself (unknown session, resume not possible), not with the agent's work. */
export class ChatError extends Error {}

export interface RunTurnDeps {
  agent: AgentRunner;
  store: SessionStore;
  now: () => Date;
}

export interface RunTurnInput {
  sessionId: string;
  prompt: string;
  timeoutMs: number;
  /** Per-turn knobs; passed to the agent and stored on the turn. */
  profile?: AgentProfile;
  /** Process executing the turn, stored until the turn ends. */
  pid?: number;
  /** Called once the turn is recorded and before the agent starts. */
  onTurnStart?: (turn: TurnRecord) => void;
  /** Called with each timeline entry right after it is stored. */
  onEvent?: (event: SessionEventRecord) => void;
}

export interface TurnSummary {
  /** The turn as it was when it started. */
  turn: TurnRecord;
  result: AgentRunResult;
  passed: boolean;
}

interface Normalizer {
  push(raw: unknown): AgentLogEntry[];
  flush(): AgentLogEntry[];
}

/** Each agent streams a different format; the session's agent decides which normalizer reads it. */
function normalizerFor(agent: string): Normalizer {
  return agent === "claude" ? new ClaudeEventNormalizer() : new AgentEventNormalizer();
}

export function turnPassed(result: AgentRunResult): boolean {
  return result.exitCode === 0 && !result.isError && !result.timedOut;
}

const MAX_TITLE_CHARS = 60;

/** Title of a new session: the first non-empty line of its first prompt, on one line and shortened. */
export function titleFromPrompt(prompt: string): string {
  const line = prompt.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).find((l) => l !== "");
  if (line === undefined) return "Untitled chat";
  return line.length > MAX_TITLE_CHARS ? `${line.slice(0, MAX_TITLE_CHARS - 1)}…` : line;
}

function checkRequest(session: SessionRecord | undefined, sessionId: string, agent: AgentRunner): SessionRecord {
  if (!session) throw new ChatError(`Session not found: ${sessionId}`);
  if (agent.name !== undefined && agent.name !== session.agent) {
    throw new ChatError(`Session ${session.id} belongs to ${session.agent}, not ${agent.name}`);
  }
  if (session.agentSessionId !== undefined && !capabilitiesOf(agent).resume) {
    throw new ChatError(
      `Session ${session.id} already has a ${session.agent} conversation, but ${session.agent} cannot resume one here. Start a new session instead.`,
    );
  }
  return session;
}

/**
 * Runs ONE turn of a session with any agent and records it: the turn, its normalized timeline (labelled with
 * the agent), the final answer with tokens, exit code and what the agent reported, and the agent's own session id
 * so the next turn can resume the same conversation.
 */
export async function runTurn(deps: RunTurnDeps, input: RunTurnInput): Promise<TurnSummary> {
  const { agent, store, now } = deps;
  const session = checkRequest(store.getSession(input.sessionId), input.sessionId, agent);
  const resumeSessionId = session.agentSessionId;

  const turn = store.startTurn({
    sessionId: session.id,
    prompt: input.prompt,
    startedAt: now().toISOString(),
    ...(input.profile ? { profile: input.profile } : {}),
    ...(input.pid !== undefined ? { pid: input.pid } : {}),
  });
  input.onTurnStart?.(turn);

  const normalizer = normalizerFor(session.agent);
  const record = (entries: AgentLogEntry[]): void => {
    for (const entry of entries) {
      const event: SessionEventRecord = {
        sessionId: session.id, turnId: turn.id, ts: now().toISOString(), kind: entry.kind, payload: entry.payload, agent: session.agent,
      };
      store.recordEvent(event);
      input.onEvent?.(event);
    }
  };

  let result: AgentRunResult;
  try {
    result = await agent.run(
      {
        cwd: session.cwd,
        prompt: input.prompt,
        timeoutMs: input.timeoutMs,
        ...(resumeSessionId !== undefined ? { resumeSessionId } : {}),
        ...(input.profile ? { profile: input.profile } : {}),
      },
      (e) => record(normalizer.push(e.raw)),
    );
  } catch (err) {
    // Same as the run loop: whatever the normalizer still buffers is stored, and the turn is closed so it does not stay `running`.
    record(normalizer.flush());
    store.finishTurn(turn.id, {
      status: "failed",
      finishedAt: now().toISOString(),
      resultText: `Agent error: ${err instanceof Error ? err.message : String(err)}`,
    });
    throw err;
  }
  record(normalizer.flush());

  if (result.sessionId !== undefined && result.sessionId !== session.agentSessionId) {
    store.setAgentSessionId(session.id, result.sessionId, now().toISOString());
  }
  const passed = turnPassed(result);
  store.finishTurn(turn.id, {
    status: passed ? "passed" : "failed",
    finishedAt: now().toISOString(),
    resultText: result.resultText,
    ...(result.inputTokens !== undefined ? { inputTokens: result.inputTokens } : {}),
    ...(result.outputTokens !== undefined ? { outputTokens: result.outputTokens } : {}),
    exitCode: result.exitCode,
    ...(result.meta ? { meta: result.meta } : {}),
  });
  return { turn, result, passed };
}

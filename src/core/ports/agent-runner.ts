/** Port: how the core asks an agent CLI to do one unit of work. */

/** Per-turn knobs an agent may honour. Each field is passed to the CLI as a flag when set. */
export interface AgentProfile {
  model?: string;
  effort?: string;
  permissionMode?: string;
}

export interface AgentRunRequest {
  /** Directory the agent runs in (the task worktree). */
  cwd: string;
  prompt: string;
  timeoutMs: number;
  /** Continue an existing agent session instead of starting a new one. Ignored by agents without `resume`. */
  resumeSessionId?: string;
  /** Per-turn profile; overrides the defaults the runner was built with. */
  profile?: AgentProfile;
}

/** One rate-limit window an agent reports (for example `five_hour`). */
export interface AgentPlanUsage {
  name: string;
  /** Fraction of the window already used, 0 to 1. */
  utilization: number;
  /** Unix time (seconds) at which the window resets. */
  resetsAt?: number;
}

/** Extra facts a runner may learn from the stream, beyond the answer itself. */
export interface AgentRunMeta {
  /** Slash commands the agent offers, without the leading `/`. */
  commands?: string[];
  planUsage?: AgentPlanUsage[];
  model?: string;
}

export interface AgentRunResult {
  exitCode: number | null;
  isError: boolean;
  /** Final text answer of the agent. */
  resultText: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  sessionId?: string;
  timedOut: boolean;
  meta?: AgentRunMeta;
}

export type AgentEvent = { type: string; raw: unknown };

/** What an agent adapter can do; the interface renders from this, never from the agent's name. */
export interface AgentCapabilities {
  /** `resumeSessionId` continues the same conversation. */
  resume: boolean;
  /** The model can be chosen per turn through `profile.model`. */
  chooseModel: boolean;
  /** The agent reports its own slash-command list (`meta.commands`). */
  commandList: boolean;
  /** Reasoning arrives readable in the stream. */
  visibleReasoning: boolean;
  /** The agent reports plan usage (`meta.planUsage`). */
  planUsage: boolean;
}

export interface AgentRunner {
  /** Short identifier stored with every timeline entry, for example `cursor`. */
  readonly name?: string;
  /** Omitted by simple runners and fakes: they are treated as supporting nothing optional. */
  readonly capabilities?: AgentCapabilities;
  run(request: AgentRunRequest, onEvent?: (event: AgentEvent) => void): Promise<AgentRunResult>;
}

export const NO_CAPABILITIES: AgentCapabilities = {
  resume: false,
  chooseModel: false,
  commandList: false,
  visibleReasoning: false,
  planUsage: false,
};

/** The runner's declared capabilities, or all-false when it declares none. */
export function capabilitiesOf(runner: AgentRunner): AgentCapabilities {
  return { ...NO_CAPABILITIES, ...runner.capabilities };
}

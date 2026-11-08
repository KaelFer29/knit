/** Port: how the core asks an agent CLI to do one unit of work. */
export interface AgentRunRequest {
  /** Directory the agent runs in (the task worktree). */
  cwd: string;
  prompt: string;
  timeoutMs: number;
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
}

export type AgentEvent = { type: string; raw: unknown };

export interface AgentRunner {
  /** Short identifier stored with every timeline entry, for example `cursor`. */
  readonly name?: string;
  run(request: AgentRunRequest, onEvent?: (event: AgentEvent) => void): Promise<AgentRunResult>;
}

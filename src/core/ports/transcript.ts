import type { AgentEvent } from "./agent-runner.js";

/** Port: the raw, full-fidelity stream of one agent attempt. */
export interface Transcript {
  readonly path: string;
  append(event: AgentEvent): void;
  close(): void;
}

export interface TranscriptStore {
  open(ctx: { runId: string; taskId: string; attempt: number }): Transcript;
}

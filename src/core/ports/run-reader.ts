import type { AgentEventRecord, AttemptRecord, EventRecord, RunRecord, RunStatus, TaskRecord } from "./run-store.js";

/**
 * Port: read side of the run database, used by the web interface.
 *
 * It never writes. Every row of the two incremental tables (`events`, `agent_events`) carries its numeric `id`, so a
 * caller can resume exactly where it stopped by passing the last id it saw. Optional columns stay absent on the
 * returned objects (older databases simply do not have them).
 */

/** A run as stored: the record plus its lifecycle state. */
export interface StoredRun extends RunRecord {
  status: RunStatus;
  finishedAt?: string;
}

/** A lifecycle event with its database id. */
export interface StoredEvent extends EventRecord {
  id: number;
}

/** An agent timeline entry with its database id. `agent` is always set (rows from before schema 4 are Cursor's). */
export interface StoredAgentEvent extends Omit<AgentEventRecord, "agent"> {
  id: number;
  agent: string;
}

export interface TaskCounts {
  total: number;
  pending: number;
  running: number;
  passed: number;
  failed: number;
}

/** One line of the runs list. */
export interface RunListItem {
  run: StoredRun;
  taskCounts: TaskCounts;
  /** Sum over every attempt of the run; 0 when the agent reported none. */
  inputTokens: number;
  outputTokens: number;
}

/** Everything the page needs to draw one run, read from a single consistent point in time. */
export interface RunSnapshot {
  run: StoredRun;
  tasks: TaskRecord[];
  attempts: AttemptRecord[];
  events: StoredEvent[];
  /** Highest `events.id` of the run (0 when none): where `getEventsAfter` resumes. */
  lastEventId: number;
  /** Highest `agent_events.id` of the run (0 when none): where `getAgentEventsAfter` resumes. */
  lastAgentEventId: number;
}

export interface AgentEventFilter {
  taskId?: string;
  attempt?: number;
  limit?: number;
}

export interface RunReader {
  /** Runs, newest first. */
  listRuns(): RunListItem[];
  /** One run alone, without its tasks or events: the cheap read for a status check. */
  getRun(runId: string): StoredRun | undefined;
  getRunSnapshot(runId: string): RunSnapshot | undefined;
  /** Lifecycle events of a run with `id > afterId`, oldest first. */
  getEventsAfter(runId: string, afterId: number, limit?: number): StoredEvent[];
  /** Agent timeline entries of a run with `id > afterId`, oldest first, optionally for one task or attempt. */
  getAgentEventsAfter(runId: string, afterId: number, filter?: AgentEventFilter): StoredAgentEvent[];
  /** The newest `limit` agent timeline entries of a run, oldest first, optionally for one task or attempt. */
  getLatestAgentEvents(runId: string, limit: number, filter?: Omit<AgentEventFilter, "limit">): StoredAgentEvent[];
  close(): void;
}

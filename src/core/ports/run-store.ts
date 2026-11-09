/** Port: persistence of runs, task state, attempts and events. */
export type RunStatus = "running" | "passed" | "failed";
export type TaskStatus = "pending" | "running" | "passed" | "failed";
export type AttemptStatus = "passed" | "failed";

export interface RunRecord {
  id: string;
  planName: string;
  planPath: string;
  repo: string;
  base: string;
  startedAt: string;
  /** Snapshot of the plan file as it was when the run started. */
  planText?: string;
  /** Process that is executing the run; cleared when the run finishes. */
  pid?: number;
}

export interface TaskSpec {
  id: string;
  text: string;
}

export interface TaskRecord {
  runId: string;
  taskId: string;
  title: string;
  status: TaskStatus;
  branch?: string;
  worktree?: string;
  /** Commit the task branch started from. */
  startSha?: string;
  /** Last commit of the task branch once it passed. */
  commitSha?: string;
  prUrl?: string;
  goal?: string;
  /** Task whose branch this one starts from. */
  dependsOn?: string;
  /** 1-based position in the plan, which is also the execution order. */
  position?: number;
  specs?: TaskSpec[];
}

export interface AttemptRecord {
  runId: string;
  taskId: string;
  /** 0 is reserved for the setup phase. */
  attempt: number;
  startedAt: string;
  durationMs: number;
  exitCode: number | null;
  isError: boolean;
  inputTokens?: number;
  outputTokens?: number;
  scopeOk: boolean;
  failedCheck?: string;
  status: AttemptStatus;
  sessionId?: string;
  resultText?: string;
}

export interface EventRecord {
  runId: string;
  taskId?: string;
  attempt?: number;
  ts: string;
  type: string;
  payload?: unknown;
}

/** One entry of the agent's normalized timeline (thinking, messages, tool calls...). */
export interface AgentEventRecord {
  runId: string;
  taskId?: string;
  attempt?: number;
  ts: string;
  kind: string;
  payload?: unknown;
  /** Agent that produced the entry; stores default to `cursor` when absent. */
  agent?: string;
}

export interface RunStore {
  createRun(run: RunRecord): void;
  finishRun(id: string, status: RunStatus, finishedAt: string): void;
  /** Marks a finished run as running again (resume), owned by the given process. */
  reopenRun(id: string, pid?: number): void;
  getTasks(runId: string): TaskRecord[];
  /** Number to use for the next attempt of a task (1 when it has none yet). */
  nextAttempt(runId: string, taskId: string): number;
  upsertTask(task: TaskRecord): void;
  recordAttempt(attempt: AttemptRecord): void;
  recordEvent(event: EventRecord): void;
  recordAgentEvent(event: AgentEventRecord): void;
}

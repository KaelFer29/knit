/** One line of `GET /api/runs`. Mirrors `RunListItem` of the server; only what the page reads. */
export interface RunListItem {
  run: { id: string; planName: string; planPath: string; startedAt: string; finishedAt?: string; status: "running" | "passed" | "failed" };
  taskCounts: { total: number; pending: number; running: number; passed: number; failed: number };
  inputTokens: number;
  outputTokens: number;
}

/** What the control routes answer (202). */
export interface Started {
  runId: string;
  pid?: number;
  logPath: string;
}

export interface StartOptions {
  planPath: string;
  push: boolean;
  pr: boolean;
  maxAttempts?: number;
}

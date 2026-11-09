/** Shapes the detail panels read. They mirror the JSON of the HTTP API; `web/` never imports runtime code from `src/`. */

export interface TimelineEntry {
  id: number;
  ts: string;
  kind: string;
  payload?: unknown;
  /** Which agent wrote the entry; shown, never branched on. */
  agent?: string;
}

export type DiffFileStatus = "added" | "modified" | "deleted";

export interface DiffFile {
  path: string;
  status: DiffFileStatus;
  binary: boolean;
  additions?: number;
  deletions?: number;
  patch?: string;
  truncated?: boolean;
}

export interface TaskDiffData {
  startSha: string;
  commitSha?: string;
  files: DiffFile[];
  moreFiles: boolean;
}

/** What Knit recorded about one attempt besides the board's own fields. */
export interface AttemptNotes {
  /** The attempt's recorded output: the setup command's output for attempt 0, the agent's final answer otherwise. */
  output?: string;
  /** Problems Knit found in the task's commit history (extra commits, a dirty tree...). */
  gitProblems: string[];
}

/** Where the detail panels get what the board does not carry. The live source reads the API; fixtures supply their own. */
export interface DetailSource {
  /** The plan as Claude wrote it, when the run stored it. */
  planText?: string;
  attemptNotes(taskId: string, attempt: number): AttemptNotes;
  timeline(taskId: string, attempt: number): Promise<TimelineEntry[]>;
  diff(taskId: string): Promise<TaskDiffData>;
}

import { apiGet } from "../api/client";
import type { AttemptNotes, DetailSource, TaskDiffData, TimelineEntry } from "./types";

/** The parts of `GET /api/runs/:id` this source reads. */
export interface SnapshotParts {
  run: { id: string; planText?: string };
  attempts: { taskId: string; attempt: number; resultText?: string }[];
  events: { type: string; taskId?: string; attempt?: number; payload?: unknown }[];
}

type Fetcher = <T>(path: string) => Promise<T>;

const enc = encodeURIComponent;

function problemsOf(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null || !("gitProblems" in payload)) return [];
  const problems = (payload as { gitProblems: unknown }).gitProblems;
  return Array.isArray(problems) ? problems.filter((p): p is string => typeof p === "string") : [];
}

/**
 * Detail data for a live run: notes come from the snapshot already fetched, the timeline and the diff are fetched
 * only when a panel asks for them.
 */
export function createApiDetailSource(snapshot: SnapshotParts, fetcher: Fetcher = apiGet): DetailSource {
  const runPath = `/api/runs/${enc(snapshot.run.id)}`;
  return {
    ...(snapshot.run.planText === undefined ? {} : { planText: snapshot.run.planText }),
    attemptNotes(taskId, attempt): AttemptNotes {
      const row = snapshot.attempts.find((a) => a.taskId === taskId && a.attempt === attempt);
      const finished = snapshot.events.filter((e) => e.type === "attempt.finished" && e.taskId === taskId && e.attempt === attempt).at(-1);
      return { ...(row?.resultText === undefined ? {} : { output: row.resultText }), gitProblems: problemsOf(finished?.payload) };
    },
    async timeline(taskId, attempt): Promise<TimelineEntry[]> {
      const body = await fetcher<{ events: TimelineEntry[] }>(`${runPath}/tasks/${enc(taskId)}/attempts/${attempt}/timeline`);
      return body.events;
    },
    async diff(taskId): Promise<TaskDiffData> {
      return fetcher<TaskDiffData>(`${runPath}/tasks/${enc(taskId)}/diff`);
    },
  };
}

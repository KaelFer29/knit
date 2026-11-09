import type { TaskView } from "@board";
import { StatusBadge } from "../../../atoms/StatusBadge";
import type { DetailSource } from "../../../detail/types";
import { useTaskDiffs } from "../../../detail/useTaskDiffs";
import { DiffView } from "../../../organisms/DiffView";
import "./ChangedFiles.css";

interface Props {
  tasks: TaskView[];
  source: DetailSource | undefined;
}

/**
 * What Cursor changed, and only that: one group per task that has started, each with its changed files (and their
 * hunks one click away). The repository itself is not shown; the files here are the ones a task touched.
 */
export function ChangedFiles({ tasks, source }: Props) {
  const started = tasks.filter((t) => t.state !== "queued");
  const diffs = useTaskDiffs(source, started.map((t) => t.taskId));
  const anyFiles = started.some((t) => {
    const d = diffs[t.taskId];
    return d?.state === "ready" && d.diff.files.length > 0;
  });
  const settled = started.every((t) => diffs[t.taskId]?.state !== "loading" && diffs[t.taskId] !== undefined);
  if (started.length === 0 || (settled && !anyFiles && started.every((t) => diffs[t.taskId]?.state === "ready"))) {
    return <p className="detail-note">Cursor has not changed any file yet. Its changes appear here, task by task.</p>;
  }
  return (
    <div className="changed-files">
      {started.map((task) => {
        const d = diffs[task.taskId];
        return (
          <section key={task.taskId} className="changed-files__group" aria-label={`Changes of ${task.taskId}`}>
            <header className="changed-files__head">
              <span className="changed-files__id">{task.taskId}</span>
              <span className="changed-files__title">{task.title}</span>
              <StatusBadge state={task.state} />
            </header>
            {d === undefined || d.state === "loading" ? (
              <p className="detail-note" role="status">
                Reading the changes…
              </p>
            ) : d.state === "error" ? (
              <p className="detail-note" role="alert">
                Could not read the changes: {d.message}
              </p>
            ) : (
              <DiffView diff={d.diff} />
            )}
          </section>
        );
      })}
    </div>
  );
}

import type { TaskView } from "@board";
import { StatusBadge } from "../../../atoms/StatusBadge";
import type { DetailSource, TaskDiffData } from "../../../detail/types";
import { useTaskDiffs, type TaskDiffState } from "../../../detail/useTaskDiffs";
import { useList } from "../../../lists/useList";
import { Disclosure } from "../../../molecules/Disclosure";
import { ListToolbar } from "../../../molecules/ListToolbar";
import { Pager } from "../../../molecules/Pager";
import { DiffView } from "../../../organisms/DiffView";
import "./ChangedFiles.css";

interface Props {
  tasks: TaskView[];
  source: DetailSource | undefined;
}

const PAGE_SIZE = 6;
const searchable = (t: TaskView): string[] => [t.taskId, t.title];

function totals(diff: TaskDiffData): { files: number; add: number; del: number } {
  return { files: diff.files.length, add: diff.files.reduce((n, f) => n + (f.additions ?? 0), 0), del: diff.files.reduce((n, f) => n + (f.deletions ?? 0), 0) };
}

/** The one-line summary of a group: how many files and lines it changed, or why that is not known yet. */
function Meta({ state }: { state: TaskDiffState | undefined }) {
  if (state === undefined || state.state === "loading") return <>reading…</>;
  if (state.state === "error") return <>unavailable</>;
  const { files, add, del } = totals(state.diff);
  return (
    <>
      {files} {files === 1 ? "file" : "files"}
      {files > 0 ? (
        <>
          {" "}
          <span className="diff__add">+{add}</span> <span className="diff__del">−{del}</span>
        </>
      ) : null}
    </>
  );
}

/**
 * What Cursor changed, and only that: one collapsed row per task that has started, with its file and line counts; the
 * files and their hunks open on demand. Long runs are paged and searchable, and only the page shown is read.
 * The repository itself is not shown; the files here are the ones a task touched.
 */
export function ChangedFiles({ tasks, source }: Props) {
  const started = tasks.filter((t) => t.state !== "queued");
  const list = useList({ items: started, pageSize: PAGE_SIZE, fields: searchable });
  const diffs = useTaskDiffs(source, list.view.items.map((t) => t.taskId));
  const shown = list.view.items;
  const nothingChanged = list.view.pages === 1 && !list.narrowed && shown.every((t) => diffs[t.taskId]?.state === "ready" && (diffs[t.taskId] as { diff: TaskDiffData }).diff.files.length === 0);
  if (started.length === 0 || nothingChanged) {
    return <p className="detail-note">Cursor has not changed any file yet. Its changes appear here, task by task.</p>;
  }
  return (
    <div className="changed-files">
      {started.length > 1 ? <ListToolbar label="Search changed tasks" query={list.query} onQuery={list.setQuery} summary={list.narrowed ? `${list.matching} of ${started.length} tasks` : undefined} /> : null}
      {list.view.total === 0 ? <p className="detail-note">No task matches this search.</p> : null}
      {shown.map((task) => {
        const d = diffs[task.taskId];
        return (
          <section key={task.taskId} className="changed-files__group" aria-label={`Changes of ${task.taskId}`}>
            <Disclosure
              defaultOpen={started.length === 1}
              title={
                <span className="changed-files__head">
                  <span className="changed-files__id">{task.taskId}</span>
                  <span className="changed-files__title">{task.title}</span>
                  <StatusBadge state={task.state} />
                </span>
              }
              meta={<Meta state={d} />}
            >
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
            </Disclosure>
          </section>
        );
      })}
      <Pager page={list.view} onPage={list.setPage} noun="tasks" />
    </div>
  );
}

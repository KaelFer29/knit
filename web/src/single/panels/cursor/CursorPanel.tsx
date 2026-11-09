import { FilesView } from "../../../containers/FilesView";
import { demoFilesApi } from "../../../files/demo";
import { httpFilesApi } from "../../../files/api";
import type { PanelProps } from "../registry";

/** Cursor's panel body. For now the active task's detail and the file explorer; task U5 replaces it. */
export function CursorPanel({ board, runId, live, renderDetail }: PanelProps) {
  const taskId = board?.active?.taskId ?? board?.tasks[board.tasks.length - 1]?.taskId;
  const detail = taskId === undefined ? undefined : renderDetail?.({ kind: "task", taskId });
  return (
    <>
      {detail ?? <p>No task to show yet.</p>}
      {runId !== undefined && live ? <FilesView api={httpFilesApi(runId)} /> : board === undefined ? null : <FilesView api={demoFilesApi()} />}
    </>
  );
}

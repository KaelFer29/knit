import { useId, useState } from "react";
import type { TaskView } from "@board";
import { StatusBadge } from "../../../atoms/StatusBadge";
import { FilesView } from "../../../containers/FilesView";
import { demoFilesApi } from "../../../files/demo";
import { httpFilesApi } from "../../../files/api";
import type { RenderDetail } from "../../../flow/detail";
import { Disclosure } from "../../../molecules/Disclosure";
import type { PanelProps } from "../registry";
import "./CursorPanel.css";

type Tab = "agent" | "files";

function TaskHead({ task }: { task: TaskView }) {
  return (
    <span className="cursor-panel__task">
      <span className="cursor-panel__id">{task.taskId}</span>
      <span className="cursor-panel__title">{task.title}</span>
      <StatusBadge state={task.state} />
    </span>
  );
}

function Primary({ task, label, renderDetail }: { task: TaskView; label: string; renderDetail: RenderDetail | undefined }) {
  return (
    <section className="cursor-panel__primary" aria-label={label} data-state={task.state}>
      <h3 className="cursor-panel__heading">{label === "Active task" ? "Now" : "Latest"}</h3>
      <TaskHead task={task} />
      {renderDetail?.({ kind: "task", taskId: task.taskId }) ?? <p className="detail-note">Loading the task detail…</p>}
    </section>
  );
}

/** Cursor's panel: the active task and its live timeline first, the other tasks as rows, and the file explorer in a tab. */
export function CursorPanel({ board, runId, live, renderDetail }: PanelProps) {
  const [tab, setTab] = useState<Tab>("agent");
  const id = useId();
  const primary = board === undefined ? undefined : (board.tasks.find((t) => t.taskId === board.active?.taskId) ?? board.tasks[board.tasks.length - 1]);
  const others = board?.tasks.filter((t) => t !== primary) ?? [];
  const files = runId !== undefined && live ? httpFilesApi(runId) : board === undefined ? undefined : demoFilesApi();
  const tabs: { id: Tab; label: string }[] = [
    { id: "agent", label: "Agent" },
    { id: "files", label: "Files" },
  ];
  return (
    <div className="cursor-panel">
      <div className="cursor-panel__tabs" role="tablist" aria-label="Cursor">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${id}-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`${id}-body`}
            tabIndex={tab === t.id ? 0 : -1}
            className="cursor-panel__tab"
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") setTab(tab === "agent" ? "files" : "agent");
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="cursor-panel__body" role="tabpanel" id={`${id}-body`} aria-labelledby={`${id}-${tab}`}>
        {tab === "files" ? (
          files === undefined ? <p className="detail-note">No repository to show yet.</p> : <FilesView api={files} />
        ) : primary === undefined ? (
          <p className="detail-note">No task to show yet.</p>
        ) : (
          <>
            <Primary task={primary} label={board?.active?.taskId === primary.taskId ? "Active task" : "Latest task"} renderDetail={renderDetail} />
            {others.length === 0 ? null : (
              <section className="cursor-panel__others" aria-label="Other tasks">
                <h3 className="cursor-panel__heading">Other tasks</h3>
                {others.map((task) => (
                  <Disclosure key={task.taskId} title={<TaskHead task={task} />}>
                    {renderDetail?.({ kind: "task", taskId: task.taskId }) ?? <p className="detail-note">Loading the task detail…</p>}
                  </Disclosure>
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

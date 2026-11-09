import { useId, useState } from "react";
import type { BoardModel, TaskView } from "@board";
import { BrandArt } from "../../../atoms/BrandArt";
import { AGENTS } from "../../../identity/agents";
import { StatusBadge } from "../../../atoms/StatusBadge";
import { FilesView } from "../../../containers/FilesView";
import { demoFilesApi } from "../../../files/demo";
import { httpFilesApi } from "../../../files/api";
import type { RenderDetail } from "../../../flow/detail";
import { formatDuration, formatTokens } from "../../../flow/format";
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

/** What the panel says before Cursor has been given anything: not an empty box, but what will appear here. */
function Waiting() {
  return (
    <section className="cursor-panel__idle" aria-label="Cursor is idle">
      <BrandArt identity={AGENTS.cursor} className="cursor-panel__idle-art" />
      <h3 className="cursor-panel__idle-title">Waiting for a task</h3>
      <p className="cursor-panel__idle-text">Cursor is the hands of the workflow: it works when the orchestrator hands it one. You do not write to it; you watch it.</p>
      <ul className="cursor-panel__idle-list" aria-label="What will appear here">
        <li>Its reasoning and every tool it uses, live</li>
        <li>The changes it makes, task by task</li>
        <li>The files it touched and the repository</li>
        <li>Tokens, attempts and time</li>
      </ul>
    </section>
  );
}

/** Where Cursor is: working on the open task, or idle and why. */
function stateLine(board: BoardModel): string {
  if (board.active !== undefined) return `Working on ${board.active.taskId} · ${board.active.title}`;
  const failed = board.tasks.find((t) => t.state === "failed");
  if (failed !== undefined) return `Idle · ${failed.taskId} failed`;
  if (board.tasks.length > 0 && board.tasks.every((t) => t.state === "delivered")) return "Idle · every task delivered";
  return "Idle · waiting for the next task";
}

function Summary({ board }: { board: BoardModel }) {
  const { totals } = board;
  const stats: [string, string][] = [
    ["Tasks", `${totals.tasks.delivered} of ${totals.tasks.total}`],
    ["Attempts", String(totals.attempts)],
    ["Tokens", formatTokens(totals.tokens.cursor.input + totals.tokens.cursor.output)],
    ["Agent time", formatDuration(totals.agentMs)],
  ];
  return (
    <section className="cursor-panel__summary" aria-label="Summary">
      <p className="cursor-panel__state" role="status" aria-label="Cursor state" data-working={board.active !== undefined}>
        <span className="cursor-panel__dot" aria-hidden="true" />
        {stateLine(board)}
      </p>
      <dl className="cursor-panel__stats">
        {stats.map(([label, value]) => (
          <div key={label} className="cursor-panel__stat">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Cursor's panel: where it is and a summary of the run, the active task and its live timeline, the history of the other tasks and the file explorer in a tab. It is watched, not written to. */
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
  if (board === undefined) {
    return (
      <div className="cursor-panel">
        <Waiting />
      </div>
    );
  }
  return (
    <div className="cursor-panel">
      <Summary board={board} />
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
          <p className="detail-note">No task has started yet.</p>
        ) : (
          <>
            <Primary task={primary} label={board?.active?.taskId === primary.taskId ? "Active task" : "Latest task"} renderDetail={renderDetail} />
            {others.length === 0 ? null : (
              <section className="cursor-panel__others" aria-label="History">
                <h3 className="cursor-panel__heading">History</h3>
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

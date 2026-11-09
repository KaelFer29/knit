import { useId, useMemo, useState } from "react";
import type { BoardModel, TaskView } from "@board";
import { BrandArt } from "../../../atoms/BrandArt";
import { AGENTS } from "../../../identity/agents";
import { StatusBadge } from "../../../atoms/StatusBadge";
import type { RenderDetail } from "../../../flow/detail";
import { formatDuration, formatTokens } from "../../../flow/format";
import { useList } from "../../../lists/useList";
import { Disclosure } from "../../../molecules/Disclosure";
import { ListToolbar } from "../../../molecules/ListToolbar";
import { Pager } from "../../../molecules/Pager";
import type { PanelProps } from "../registry";
import { BranchesView } from "./BranchesView";
import "./CursorPanel.css";

type Tab = "agent" | "branches";

const PAGE_SIZE = 8;
const searchable = (t: TaskView): string[] => [t.taskId, t.title];

function TaskHead({ task }: { task: TaskView }) {
  return (
    <span className="cursor-panel__task">
      <span className="cursor-panel__id">{task.taskId}</span>
      <span className="cursor-panel__title">{task.title}</span>
      <StatusBadge state={task.state} />
    </span>
  );
}

function Primary({ task, renderDetail }: { task: TaskView; renderDetail: RenderDetail | undefined }) {
  return (
    <section className="cursor-panel__primary" aria-label="Active task" data-state={task.state}>
      <h3 className="cursor-panel__heading">Now</h3>
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
      <div className="cursor-panel__idle-body">
        <h3 className="cursor-panel__idle-title">Waiting for a task</h3>
        <p className="cursor-panel__idle-text">Cursor is the hands of the workflow: it works when the orchestrator hands it one. You do not write to it; you watch it.</p>
        <ul className="cursor-panel__idle-list" aria-label="What will appear here">
          <li>Its reasoning and every tool it uses, live</li>
          <li>The changes it makes, task by task</li>
          <li>The files it changed, task by task</li>
          <li>Tokens, attempts and time</li>
        </ul>
      </div>
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

/** Cursor's panel: where it is and a summary of the run, the active task open with its live timeline, and every other task as a collapsed row (newest first, paged and searchable) whose detail, with the changes it made, opens on demand; in a second tab the branches it created, which can be undone or turned into pull requests. It is watched, not written to. */
export function CursorPanel({ board, runId, live, renderDetail }: PanelProps) {
  const [tab, setTab] = useState<Tab>("agent");
  const id = useId();
  const primary = board?.tasks.find((t) => t.taskId === board.active?.taskId);
  const others = useMemo(() => (board?.tasks ?? []).filter((t) => t !== primary).reverse(), [board, primary]);
  const history = useList({ items: others, pageSize: PAGE_SIZE, fields: searchable });
  const tabs: { id: Tab; label: string }[] = [
    { id: "agent", label: "Agent" },
    { id: "branches", label: "Branches" },
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
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              const at = tabs.findIndex((x) => x.id === tab);
              setTab(tabs[(at + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!.id);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="cursor-panel__body" role="tabpanel" id={`${id}-body`} aria-labelledby={`${id}-${tab}`}>
        {tab === "branches" ? (
          runId !== undefined && live ? (
            <BranchesView runId={runId} />
          ) : (
            <p className="detail-note">Branches are only available for a real run. This is sample data.</p>
          )
        ) : board.tasks.length === 0 ? (
          <p className="detail-note">No task has started yet.</p>
        ) : (
          <>
            {primary === undefined ? null : <Primary task={primary} renderDetail={renderDetail} />}
            {others.length === 0 ? null : (
              <section className="cursor-panel__others" aria-label="History">
                <h3 className="cursor-panel__heading">{primary === undefined ? "Tasks" : "History"}</h3>
                {others.length > PAGE_SIZE ? <ListToolbar label="Search tasks" query={history.query} onQuery={history.setQuery} summary={history.narrowed ? `${history.matching} of ${others.length} tasks` : undefined} /> : null}
                {history.view.items.map((task) => (
                  <Disclosure key={task.taskId} title={<TaskHead task={task} />}>
                    {renderDetail?.({ kind: "task", taskId: task.taskId }) ?? <p className="detail-note">Loading the task detail…</p>}
                  </Disclosure>
                ))}
                <Pager page={history.view} onPage={history.setPage} noun="tasks" />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

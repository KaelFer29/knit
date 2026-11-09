import { useMemo } from "react";
import { RunControlBar } from "../../../containers/RunControlBar";
import { RunsView } from "../../../containers/RunsView";
import { StageTrack } from "../../../molecules/StageTrack";
import { TaskCard } from "../../../molecules/TaskCard";
import { deriveStages } from "../../pipeline";
import type { PanelProps } from "../registry";
import { RunSummary } from "./RunSummary";
import "./KnitPanel.css";

/**
 * The orchestrator's panel. The run on top (plan, numbers, and its five stages as one track), then two columns: the
 * task queue in order, each task with its checks and verdicts one click away, and beside it run control, the form that
 * starts a run and the runs list as a picker. With no run, the form is open and says where to start.
 */
export function KnitPanel({ board, runId, live, renderDetail, selectRun }: PanelProps) {
  const stages = useMemo(() => deriveStages(board), [board]);
  return (
    <div className="knit-panel">
      {board === undefined ? (
        <section className="knit-panel__empty" aria-label="No run">
          <h3 className="knit-panel__empty-title">No run yet</h3>
          <p className="knit-panel__state">No run to show yet. Start one below, or pick a past run.</p>
          <StageTrack stages={stages} label="Run stages" detail="each" size="large" />
        </section>
      ) : (
        <>
          <RunSummary board={board} />
          <section className="knit-panel__stages" aria-label="Stages">
            <StageTrack stages={stages} label="Run stages" detail="each" size="large" />
          </section>
        </>
      )}
      <div className="knit-panel__cols" data-empty={board === undefined || undefined}>
        {board === undefined ? null : (
          <section className="knit-panel__section knit-panel__main" aria-labelledby="knit-queue">
            <h3 id="knit-queue" className="knit-panel__heading">
              Task queue
            </h3>
            <ol className="knit-panel__list">
              {board.tasks.map((task) => (
                <li key={task.taskId}>
                  <TaskCard task={{ ...task, attempts: task.attempts.filter((a) => !a.setup).length }} renderDetail={renderDetail} />
                </li>
              ))}
            </ol>
          </section>
        )}
        <div className="knit-panel__side">
          {board !== undefined && live ? <RunControlBar board={board} /> : null}
          <RunsView selectedId={runId} onSelect={selectRun} startOpen={board === undefined} />
        </div>
      </div>
    </div>
  );
}

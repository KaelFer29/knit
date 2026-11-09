import { RunControlBar } from "../../../containers/RunControlBar";
import { RunsView } from "../../../containers/RunsView";
import { TaskCard } from "../../../molecules/TaskCard";
import type { PanelProps } from "../registry";
import { RunSummary } from "./RunSummary";
import "./KnitPanel.css";

/**
 * Knit's panel body: the run the view shows (header, run control, task queue in order with each task's checks
 * and verdicts one click away) and, below, the runs list as a picker with the form that starts a new run.
 */
export function KnitPanel({ board, runId, live, renderDetail, selectRun }: PanelProps) {
  return (
    <div className="knit-panel">
      {board === undefined ? (
        <p className="knit-panel__state">No run to show yet. Start one below, or pick a past run.</p>
      ) : (
        <>
          <RunSummary board={board} />
          {live ? <RunControlBar board={board} /> : null}
          <section className="knit-panel__section" aria-labelledby="knit-queue">
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
        </>
      )}
      <RunsView selectedId={runId} onSelect={selectRun} />
    </div>
  );
}

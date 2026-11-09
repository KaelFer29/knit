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
 * The orchestrator's panel, in one column. The run comes first as one unit: its summary, its five stages as one track,
 * run control and its tasks nested under it (a task belongs to the run it is under). Below, the runs list switches
 * to another run. There is no form to start a run: plans are drafted in Claude and sent from there.
 */
export function KnitPanel({ board, runId, live, renderDetail, selectRun }: PanelProps) {
  const stages = useMemo(() => deriveStages(board), [board]);
  return (
    <div className="knit-panel">
      {board === undefined ? (
        <section className="knit-panel__empty" aria-label="No run">
          <h3 className="knit-panel__empty-title">No run yet</h3>
          <p className="knit-panel__state">Ask Claude for a plan, then send it to the orchestrator. Or pick a past run below.</p>
          <StageTrack stages={stages} label="Run stages" detail="each" size="large" />
        </section>
      ) : (
        <section className="knit-panel__run" aria-label={`Run ${board.planName}`}>
          <RunSummary board={board} />
          <div className="knit-panel__stages">
            <StageTrack stages={stages} label="Run stages" detail="each" size="large" />
          </div>
          {live ? <RunControlBar board={board} /> : null}
          <ol className="knit-panel__tasks" aria-label="Tasks of this run">
            {board.tasks.map((task) => (
              <li key={task.taskId}>
                <TaskCard task={{ ...task, attempts: task.attempts.filter((a) => !a.setup).length }} renderDetail={renderDetail} />
              </li>
            ))}
          </ol>
        </section>
      )}
      <RunsView selectedId={board?.runId ?? runId} onSelect={selectRun} />
    </div>
  );
}

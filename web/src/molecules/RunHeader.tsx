import type { BoardModel, TaskState } from "@board";
import { StatusBadge } from "../atoms/StatusBadge";
import { formatDuration } from "../flow/format";
import "./RunHeader.css";

export const RUN_TONE: Record<BoardModel["runStatus"], { state: TaskState; label: string }> = {
  running: { state: "running", label: "Running" },
  passed: { state: "delivered", label: "Passed" },
  failed: { state: "failed", label: "Failed" },
};

/** The title of the canvas: the plan, how the run is going and how long it has taken. */
export function RunHeader({ board }: { board: BoardModel }) {
  const tone = RUN_TONE[board.runStatus];
  const { delivered, total } = { delivered: board.totals.tasks.delivered, total: board.totals.tasks.total };
  return (
    <div className="run-header">
      <div className="run-header__title">
        <h1 className="run-header__plan">{board.planName}</h1>
        <p className="run-header__run">{board.runId}</p>
      </div>
      <div className="run-header__stats">
        <StatusBadge state={tone.state} label={tone.label} />
        <span>
          {delivered} of {total} delivered
        </span>
        {board.totals.elapsedMs === undefined ? null : <span>{formatDuration(board.totals.elapsedMs)}</span>}
      </div>
    </div>
  );
}

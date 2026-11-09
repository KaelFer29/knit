import type { BoardModel } from "@board";
import { StatusBadge } from "../../../atoms/StatusBadge";
import { formatDuration, formatTokens, totalTokens } from "../../../flow/format";
import { RUN_TONE } from "../../../molecules/RunHeader";
import "./RunSummary.css";

/** The run the panel shows: plan, status, progress bar, elapsed time and the tokens the builder used. */
export function RunSummary({ board }: { board: BoardModel }) {
  const tone = RUN_TONE[board.runStatus];
  const { delivered, total } = board.totals.tasks;
  const percent = total === 0 ? 0 : Math.round((delivered / total) * 100);
  const tokens = totalTokens(board.totals.tokens.cursor);
  return (
    <header className="run-summary" data-status={board.runStatus}>
      <div className="run-summary__top">
        <h3 className="run-summary__plan">{board.planName}</h3>
        <StatusBadge state={tone.state} label={tone.label} />
      </div>
      <p className="run-summary__id">{board.runId}</p>
      <div
        className="run-summary__bar"
        role="progressbar"
        aria-label="Tasks delivered"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={delivered}
        aria-valuetext={`${delivered} of ${total} delivered`}
      >
        <span className="run-summary__fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="run-summary__stats">
        <span>
          {delivered} of {total} delivered
        </span>
        <span>{tokens === 0 ? "no tokens yet" : `${formatTokens(tokens)} tokens`}</span>
        {board.totals.elapsedMs === undefined ? null : <span>{formatDuration(board.totals.elapsedMs)}</span>}
      </p>
    </header>
  );
}

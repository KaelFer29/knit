import type { BoardModel } from "@board";
import { StatusBadge } from "../../../atoms/StatusBadge";
import { formatDuration, formatTokens, totalTokens } from "../../../flow/format";
import { RUN_TONE } from "../../../molecules/RunHeader";
import "./RunSummary.css";

/** The run the panel shows: plan and status, a progress bar and the numbers (delivered, attempts, tokens, time). */
export function RunSummary({ board }: { board: BoardModel }) {
  const tone = RUN_TONE[board.runStatus];
  const { delivered, total } = board.totals.tasks;
  const percent = total === 0 ? 0 : Math.round((delivered / total) * 100);
  const tokens = totalTokens(board.totals.tokens.cursor);
  const stats: [string, string][] = [
    ["Delivered", `${delivered} of ${total}`],
    ["Attempts", String(board.totals.attempts)],
    ["Tokens", tokens === 0 ? "none yet" : formatTokens(tokens)],
    ["Elapsed", board.totals.elapsedMs === undefined ? "—" : formatDuration(board.totals.elapsedMs)],
  ];
  return (
    <section className="run-summary" data-status={board.runStatus} aria-label="Run summary">
      <div className="run-summary__top">
        <div className="run-summary__who">
          <h3 className="run-summary__plan">{board.planName}</h3>
          <p className="run-summary__id">{board.runId}</p>
        </div>
        <StatusBadge state={tone.state} label={tone.label} />
      </div>
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
      <dl className="run-summary__stats">
        {stats.map(([label, value]) => (
          <div key={label} className="run-summary__stat">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

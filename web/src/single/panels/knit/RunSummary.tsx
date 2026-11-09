import type { BoardModel } from "@board";
import { StatusBadge } from "../../../atoms/StatusBadge";
import { formatDuration, formatTokens, totalTokens } from "../../../flow/format";
import { RUN_TONE } from "../../../molecules/RunHeader";
import "./RunSummary.css";

/** The run the panel shows: plan and status, a progress bar and the numbers (delivered, attempts, tokens, time). */
/** What each number means, shown when the pointer rests on its label. */
const HINTS = {
  Delivered: "Tasks finished and merged into the run's branch, out of all the tasks of the plan.",
  Attempts: "Times Cursor ran a task. A failed check sends the task back, so attempts can be more than tasks.",
  Tokens: "Tokens Cursor used across the run, input and output together.",
  Elapsed: "From the start of the run to its end, or to now while it still runs.",
} as const;

/** The run the panel shows: plan and status, then the numbers (delivered, attempts, tokens, time), each explained on hover. */
export function RunSummary({ board }: { board: BoardModel }) {
  const tone = RUN_TONE[board.runStatus];
  const { delivered, total } = board.totals.tasks;
  const tokens = totalTokens(board.totals.tokens.cursor);
  const stats: [keyof typeof HINTS, string][] = [
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
      <dl className="run-summary__stats">
        {stats.map(([label, value]) => (
          <div key={label} className="run-summary__stat">
            <dt title={HINTS[label]} aria-description={HINTS[label]}>
              {label}
            </dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

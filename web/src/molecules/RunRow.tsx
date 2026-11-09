import { StatusBadge } from "../atoms/StatusBadge";
import { formatTokens } from "../flow/format";
import type { RunListItem } from "../runs/types";
import { RUN_TONE } from "./RunHeader";
import "./RunRow.css";

/** One run in the picker, on a single line: status, plan, progress and tokens. A button that makes it the run the view shows. */
export function RunRow({ item, active = false, onSelect }: { item: RunListItem; active?: boolean; onSelect?: (runId: string) => void }) {
  const { run, taskCounts } = item;
  const tone = RUN_TONE[run.status];
  const tokens = item.inputTokens + item.outputTokens;
  return (
    <button type="button" className="run-row" aria-current={active ? "true" : undefined} onClick={() => onSelect?.(run.id)} data-run-link title={`${run.planName} · ${run.id}`}>
      <StatusBadge state={tone.state} label={tone.label} />
      <span className="run-row__main">
        <span className="run-row__plan">{run.planName}</span>
        <span className="run-row__id">{run.id}</span>
      </span>
      <span className="run-row__tasks" data-failed={taskCounts.failed > 0 ? "true" : undefined}>
        {taskCounts.passed}/{taskCounts.total}
        {taskCounts.failed > 0 ? ` · ${taskCounts.failed} failed` : ""}
      </span>
      {tokens > 0 ? <span className="run-row__tokens">{formatTokens(tokens)} tokens</span> : null}
    </button>
  );
}

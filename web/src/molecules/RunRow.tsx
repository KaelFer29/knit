import { StatusBadge } from "../atoms/StatusBadge";
import { formatTokens, totalTokens } from "../flow/format";
import { AGENTS, AGENT_ORDER } from "../identity/agents";
import { tokensByAgent } from "../runs/tokens";
import type { RunListItem } from "../runs/types";
import { RUN_TONE } from "./RunHeader";
import "./RunRow.css";

/** One run in the picker: a button that makes it the run the view shows, with status, task progress and tokens. */
export function RunRow({ item, active = false, onSelect }: { item: RunListItem; active?: boolean; onSelect?: (runId: string) => void }) {
  const { run, taskCounts } = item;
  const tone = RUN_TONE[run.status];
  const tokens = tokensByAgent(item);
  return (
    <button type="button" className="run-row" aria-current={active ? "true" : undefined} onClick={() => onSelect?.(run.id)} data-run-link>
      <span className="run-row__main">
        <span className="run-row__plan">{run.planName}</span>
        <span className="run-row__id">{run.id}</span>
      </span>
      <StatusBadge state={tone.state} label={tone.label} />
      <span className="run-row__tasks">
        {taskCounts.passed} of {taskCounts.total} tasks
        {taskCounts.failed > 0 ? ` · ${taskCounts.failed} failed` : ""}
      </span>
      <ul className="run-row__tokens" aria-label="Tokens per agent">
        {AGENT_ORDER.map((id) => {
          const total = totalTokens(tokens[id]);
          return (
            <li key={id} className="run-row__token" style={{ "--accent": AGENTS[id].accent } as React.CSSProperties} data-empty={total === 0 ? "true" : undefined}>
              <span className="run-row__dot" aria-hidden="true" />
              <span>{AGENTS[id].label}</span>
              <span className="run-row__count">{total === 0 ? "—" : formatTokens(total)}</span>
            </li>
          );
        })}
      </ul>
    </button>
  );
}

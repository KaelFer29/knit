import { StatusBadge } from "../atoms/StatusBadge";
import { formatTokens, totalTokens } from "../flow/format";
import { AGENTS, AGENT_ORDER } from "../identity/agents";
import { runsHash } from "../route";
import { tokensByAgent } from "../runs/tokens";
import type { RunListItem } from "../runs/types";
import { RUN_TONE } from "./RunHeader";
import "./RunRow.css";

/** One run in the list: a link to its canvas with status, task progress and tokens per agent. */
export function RunRow({ item }: { item: RunListItem }) {
  const { run, taskCounts } = item;
  const tone = RUN_TONE[run.status];
  const tokens = tokensByAgent(item);
  return (
    <a className="run-row" href={runsHash(run.id)} data-run-link>
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
    </a>
  );
}

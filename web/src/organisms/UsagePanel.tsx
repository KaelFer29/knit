import { formatTokens } from "../flow/format";
import { UsageMeter } from "../molecules/UsageMeter";
import type { PlanUsage } from "../sessions/types";
import "./UsagePanel.css";

interface Props {
  /** The agent's declared `planUsage` capability: without it the panel only says so. */
  reportsPlanUsage: boolean;
  planUsage: PlanUsage[];
  /** Tokens of this session, summed over its turns. */
  inputTokens: number;
  outputTokens: number;
  now: number;
  /** One tight block for a narrow panel: meters stacked under the token total. */
  compact?: boolean;
}

/** Plan windows (when the agent reports them) and the session's token total, the answer to `/usage`. */
export function UsagePanel({ reportsPlanUsage, planUsage, inputTokens, outputTokens, now, compact }: Props) {
  const total = inputTokens + outputTokens;
  return (
    <section className={compact ? "usage-panel usage-panel--compact" : "usage-panel"} aria-label="Usage">
      <div className="usage-panel__tokens">
        <span className="usage-panel__label">Session tokens</span>
        <span className="usage-panel__total">{total === 0 ? "—" : formatTokens(total)}</span>
        {total === 0 ? null : (
          <span className="usage-panel__split">
            {formatTokens(inputTokens)} in · {formatTokens(outputTokens)} out
          </span>
        )}
      </div>
      <div className="usage-panel__plan">
        {!reportsPlanUsage ? (
          <p className="usage-panel__note">This agent does not report plan usage.</p>
        ) : planUsage.length === 0 ? (
          <p className="usage-panel__note">Plan usage appears after the first turn.</p>
        ) : (
          planUsage.map((u) => <UsageMeter key={u.name} usage={u} now={now} />)
        )}
      </div>
    </section>
  );
}

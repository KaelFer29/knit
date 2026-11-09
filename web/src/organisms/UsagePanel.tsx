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
  // Nothing to say yet (a turn that made no model call, such as /usage, reports neither tokens nor windows).
  if (reportsPlanUsage && total === 0 && planUsage.length === 0) return null;
  return (
    <section className={compact ? "usage-panel usage-panel--compact" : "usage-panel"} aria-label="Usage">
      {total === 0 ? null : (
        <div className="usage-panel__tokens">
          <span className="usage-panel__label">Session tokens</span>
          <span className="usage-panel__total">{formatTokens(total)}</span>
          <span className="usage-panel__split">
            {formatTokens(inputTokens)} in · {formatTokens(outputTokens)} out
          </span>
        </div>
      )}
      <div className="usage-panel__plan">
        {!reportsPlanUsage ? (
          <p className="usage-panel__note">This agent does not report plan usage.</p>
        ) : (
          planUsage.map((u) => <UsageMeter key={u.name} usage={u} now={now} />)
        )}
      </div>
    </section>
  );
}

import { formatAgo } from "../sessions/format";
import type { PlanWindow } from "../sessions/types";
import "./PlanUsageCard.css";

interface Props {
  windows: PlanWindow[];
  /** When the server read the windows. */
  checkedAt?: string | undefined;
  now: number;
  loading: boolean;
  error?: string | undefined;
  onRefresh: () => void;
}

/** The person's plan usage the way Claude Code's /usage screen draws it: one bar per window, with when it resets. */
export function PlanUsageCard({ windows, checkedAt, now, loading, error, onRefresh }: Props) {
  return (
    <section className="plan-usage" aria-label="Plan usage" data-loading={loading || undefined}>
      <div className="plan-usage__head">
        <h4 className="plan-usage__title">Plan usage</h4>
        <button type="button" className="plan-usage__refresh" aria-label="Refresh usage" title="Refresh usage" disabled={loading} onClick={onRefresh}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5" />
          </svg>
        </button>
      </div>
      {error !== undefined && windows.length === 0 ? <p className="plan-usage__note">{error}</p> : null}
      {windows.length === 0 && error === undefined ? <p className="plan-usage__note">{loading ? "Reading your plan…" : "No plan windows reported."}</p> : null}
      {windows.map((w) => (
        <div key={w.label} className="plan-usage__window" data-level={w.percent >= 90 ? "high" : w.percent >= 70 ? "mid" : "low"}>
          <div className="plan-usage__row">
            <span className="plan-usage__label">{w.label}</span>
            <span className="plan-usage__percent">{w.percent}% used</span>
          </div>
          <span className="plan-usage__bar" role="meter" aria-label={w.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={w.percent}>
            <span style={{ width: `${w.percent}%` }} />
          </span>
          {w.resets === undefined ? null : <span className="plan-usage__resets">Resets {w.resets}</span>}
        </div>
      ))}
      {checkedAt === undefined ? null : <p className="plan-usage__checked">Updated {formatAgo(checkedAt, now)}</p>}
    </section>
  );
}

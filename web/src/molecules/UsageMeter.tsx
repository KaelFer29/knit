import { formatResetsIn, percent, windowLabel } from "../sessions/format";
import type { PlanUsage } from "../sessions/types";
import "./UsageMeter.css";

/** One rate-limit window as a labelled bar. The number is always written out: the bar's tone never carries it alone. */
export function UsageMeter({ usage, now }: { usage: PlanUsage; now: number }) {
  const value = percent(usage.utilization);
  const tone = value >= 95 ? "critical" : value >= 80 ? "warning" : "normal";
  const resets = formatResetsIn(usage.resetsAt, now);
  return (
    <div className="usage-meter" data-tone={tone}>
      <div className="usage-meter__head">
        <span className="usage-meter__name" id={`usage-${usage.name}`}>
          {windowLabel(usage.name)}
        </span>
        <span className="usage-meter__value">{value}% used</span>
      </div>
      <div className="usage-meter__track" role="progressbar" aria-labelledby={`usage-${usage.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
        <div className="usage-meter__fill" style={{ width: `${value}%` }} />
      </div>
      {resets ? <span className="usage-meter__resets">{resets}</span> : null}
    </div>
  );
}

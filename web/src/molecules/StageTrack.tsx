import type { StageStatus, StageView } from "../single/pipeline";
import "./StageTrack.css";

interface Props {
  stages: StageView[];
  /** Accessible name of the list. */
  label: string;
  /** `now`: one line under the track about the stage in hand (compact). `each`: every stage's detail under its name. */
  detail: "now" | "each";
  size?: "compact" | "large";
}

const ICON: Record<StageStatus, string> = { idle: "", active: "", done: "✓", failed: "✕" };

/** The stage in hand to spell out: a failure first, then checks, then build, then whatever is next. */
function stageInHand(stages: StageView[]): StageView | undefined {
  const active = (id: StageView["id"]) => stages.find((s) => s.id === id && s.status === "active");
  return stages.find((s) => s.status === "failed") ?? active("checks") ?? active("build") ?? stages.find((s) => s.status === "active") ?? stages.find((s) => s.status !== "done");
}

/** The orchestrator's five stages as a track of dots joined by segments, with the status of each. Purely presentational. */
export function StageTrack({ stages, label, detail, size = "compact" }: Props) {
  const current = detail === "now" ? stageInHand(stages) : undefined;
  return (
    <div className="stage-track" data-size={size}>
      <ol className="pipe__stages" aria-label={label}>
        {stages.map((s) => (
          <li key={s.id} className="pipe__stage" data-status={s.status}>
            <span className="pipe__dot" aria-hidden="true">
              {ICON[s.status]}
            </span>
            <span className="pipe__label">{s.label}</span>
            {detail === "each" && s.detail !== undefined ? <span className="pipe__detail">{s.detail}</span> : null}
            <span className="sr-only">
              , {s.status}
              {detail === "now" && s.detail !== undefined ? `, ${s.detail}` : ""}
            </span>
          </li>
        ))}
      </ol>
      {current?.detail !== undefined ? (
        <p className="pipe__now" aria-hidden="true">
          {current.label} · {current.detail}
        </p>
      ) : null}
    </div>
  );
}

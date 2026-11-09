import type { CSSProperties } from "react";
import { hopProgress, type HopView } from "../single/pipeline";
import "./PipelineHop.css";

/** Curves of the wire, in a box stretched to the cell (strokes keep their screen width). */
const WIRE_H = "M0 20 C 38 4, 62 36, 100 20";
const WIRE_V = "M20 0 C 20 40, 20 60, 20 100";
/** The return hop leaves Cursor's underside and comes back under Knit: a U under the row. */
const WIRE_U = "M82 0 C 82 56, 18 56, 18 0";

const isDone = (hop: HopView, i: number): boolean => i < hop.stageIndex || (i === hop.stageIndex && hop.status === "done");

function Wire({ className, box, d }: { className: string; box: string; d: string }) {
  return (
    <svg className={`hop__svg ${className}`} viewBox={box} preserveAspectRatio="none" focusable="false">
      <path className="hop__track" d={d} />
      <path className="hop__flow" d={d} />
      <path className="hop__flow hop__flow--dots" d={d} />
    </svg>
  );
}

/**
 * One hop of the pipeline, drawn like a pipeline stage: a curved wire that carries particles while something travels
 * on it, the row of stage chips with the current one highlighted and the finished ones checked, and the last lines of
 * what travels. Purely presentational; motion is CSS and stops under `prefers-reduced-motion`.
 */
export function PipelineHop({ hop }: { hop: HopView }) {
  const returning = hop.id === "result";
  return (
    <section className="hop" data-hop={hop.id} data-status={hop.status} aria-label={hop.label} style={{ "--progress": hopProgress(hop) } as CSSProperties}>
      <div className="hop__wire" aria-hidden="true">
        <Wire className="hop__svg--h" box={returning ? "0 0 100 50" : "0 0 100 40"} d={returning ? WIRE_U : WIRE_H} />
        <Wire className="hop__svg--v" box="0 0 40 100" d={WIRE_V} />
        <span className="hop__port hop__port--start" />
        <span className="hop__port hop__port--end" />
      </div>
      <div className="hop__body">
        <p className="hop__label">{hop.label}</p>
        <ol className="hop__stages" aria-label={`${hop.label} stages`}>
          {hop.stages.map((name, i) => (
            <li key={name} className="hop__stage" data-reached={i <= hop.stageIndex} data-done={isDone(hop, i)} data-current={i === hop.stageIndex} {...(i === hop.stageIndex ? { "aria-current": "step" as const } : {})}>
              <span className="hop__check" aria-hidden="true">
                {isDone(hop, i) ? "✓" : i + 1}
              </span>
              <span className="hop__stage-name">{name}</span>
            </li>
          ))}
        </ol>
        <p className="hop__current">
          <span className="sr-only">Stage: </span>
          {hop.stage}
        </p>
        <ul className="hop__log" aria-label={`${hop.label} log`}>
          {hop.lines.map((line, i) => (
            <li key={`${i}-${line}`} className="hop__line" title={line} style={{ "--i": i } as CSSProperties}>
              {line}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

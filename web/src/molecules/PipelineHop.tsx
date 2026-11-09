import type { HopView } from "../single/pipeline";
import "./PipelineHop.css";

/**
 * One hop of the pipeline, drawn like a pipeline stage: a wire that flows while something travels on it, the row of
 * stages with the current one marked, and the last lines of what travels. Purely presentational.
 */
export function PipelineHop({ hop }: { hop: HopView }) {
  return (
    <section className="hop" data-hop={hop.id} data-status={hop.status} aria-label={hop.label}>
      <p className="hop__label">{hop.label}</p>
      <div className="hop__wire" aria-hidden="true" />
      <ol className="hop__stages" aria-label={`${hop.label} stages`}>
        {hop.stages.map((name, i) => (
          <li key={name} className="hop__stage" data-reached={i <= hop.stageIndex} data-current={i === hop.stageIndex} {...(i === hop.stageIndex ? { "aria-current": "step" as const } : {})}>
            <span className="hop__dot" aria-hidden="true" />
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
          <li key={`${i}-${line}`} className="hop__line">
            {line}
          </li>
        ))}
      </ul>
    </section>
  );
}

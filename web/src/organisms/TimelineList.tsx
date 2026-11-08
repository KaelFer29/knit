import { describeEntry } from "../detail/describe";
import type { TimelineEntry } from "../detail/types";
import "./detail.css";

interface Props {
  entries: TimelineEntry[];
}

const time = (ts: string): string => (ts.length >= 19 ? ts.slice(11, 19) : ts);

/** The agent's timeline of one attempt, oldest first. Every value renders as text. */
export function TimelineList({ entries }: Props) {
  if (entries.length === 0) return <p className="detail-note">The agent recorded nothing for this attempt.</p>;
  return (
    <ol className="timeline" aria-label="Agent timeline">
      {entries.map((entry) => {
        const view = describeEntry(entry);
        return (
          <li key={entry.id} className="timeline__item" data-kind={entry.kind} data-error={view.error ? "true" : undefined}>
            <span className="timeline__label">{view.label}</span>
            <time className="timeline__time" dateTime={entry.ts}>
              {time(entry.ts)}
            </time>
            {view.text === "" ? null : <span className={view.mono ? "timeline__text timeline__text--mono" : "timeline__text"}>{view.text}</span>}
          </li>
        );
      })}
    </ol>
  );
}

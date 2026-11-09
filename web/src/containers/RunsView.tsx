import { moveFocus } from "../organisms/RunsList";
import { RunRow } from "../molecules/RunRow";
import { useRuns } from "../runs/useRuns";
import "./RunsView.css";

interface Props {
  pollMs?: number;
  /** The run the view shows now. */
  selectedId?: string | undefined;
  /** Makes a run the one the view shows; `undefined` goes back to the most recent run. */
  onSelect: (runId: string | undefined) => void;
}

/** Container: the runs picker, newest first. Runs are not started here: a plan is drafted in Claude and sent from there. */
export function RunsView({ pollMs, selectedId, onSelect }: Props) {
  const { runs, error, reload } = useRuns(pollMs);
  return (
    <>
      <section className="knit-panel__section" aria-labelledby="knit-runs">
        <h3 id="knit-runs" className="knit-panel__heading">
          Runs
          <button type="button" className="knit-panel__link" onClick={() => onSelect(undefined)}>
            Latest
          </button>
        </h3>
        {runs === undefined && error !== undefined ? (
          <div className="knit-panel__state" role="alert">
            <p>Could not load the runs: {error}</p>
            <button type="button" className="knit-panel__link" onClick={reload}>
              Try again
            </button>
          </div>
        ) : runs === undefined ? (
          <p className="knit-panel__state" role="status">
            Loading runs…
          </p>
        ) : runs.length === 0 ? (
          <div className="knit-panel__state">
            <p className="knit-panel__strong">No runs yet</p>
            <p>
              Plans come from Claude: turn on “Send to the orchestrator”, then send the draft it writes. A run started in a terminal with <code>knit run &lt;plan.md&gt;</code> appears here too.
            </p>
          </div>
        ) : (
          <>
            {error === undefined ? null : (
              <p className="knit-panel__state" role="status">
                Could not refresh: {error}
              </p>
            )}
            <ul className="knit-panel__list" aria-label="Runs" onKeyDown={moveFocus}>
              {runs.map((item) => (
                <li key={item.run.id}>
                  <RunRow item={item} active={item.run.id === selectedId} onSelect={onSelect} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}

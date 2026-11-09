import { useState } from "react";
import { StartRunForm } from "../organisms/StartRunForm";
import { moveFocus } from "../organisms/RunsList";
import { RunRow } from "../molecules/RunRow";
import { startRun } from "../runs/api";
import type { StartOptions } from "../runs/types";
import { useRuns } from "../runs/useRuns";
import "./RunsView.css";

interface Props {
  pollMs?: number;
  /** The run the view shows now. */
  selectedId?: string | undefined;
  /** Makes a run the one the view shows; `undefined` goes back to the most recent run. */
  onSelect: (runId: string | undefined) => void;
}

/** Container: the runs picker (newest first) with the form that starts a new run. A started run becomes the shown one. */
export function RunsView({ pollMs, selectedId, onSelect }: Props) {
  const { runs, error, reload } = useRuns(pollMs);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string>();
  const start = async (options: StartOptions): Promise<void> => {
    setBusy(true);
    setStartError(undefined);
    try {
      const started = await startRun(options);
      onSelect(started.runId);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Could not start the run");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <details className="knit-panel__start">
        <summary>Start a run</summary>
        <StartRunForm busy={busy} error={startError} onStart={(o) => void start(o)} />
      </details>
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
              Start one from a plan file above, or run <code>knit run &lt;plan.md&gt;</code> in a terminal; it will appear here.
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

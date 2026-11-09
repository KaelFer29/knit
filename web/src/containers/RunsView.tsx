import { useMemo, useState } from "react";
import { useList } from "../lists/useList";
import { ListToolbar } from "../molecules/ListToolbar";
import { Pager } from "../molecules/Pager";
import { RunRow } from "../molecules/RunRow";
import { moveFocus } from "../organisms/RunsList";
import type { RunListItem } from "../runs/types";
import { useRuns } from "../runs/useRuns";
import "./RunsView.css";

const PAGE_SIZE = 8;
type StatusFilter = "all" | RunListItem["run"]["status"];
const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "failed", label: "Failed" },
  { id: "passed", label: "Passed" },
];
const searchable = (item: RunListItem): string[] => [item.run.planName, item.run.id];

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
  const [status, setStatus] = useState<StatusFilter>("all");
  const accept = useMemo(() => (item: RunListItem) => status === "all" || item.run.status === status, [status]);
  const list = useList({ items: runs ?? [], pageSize: PAGE_SIZE, fields: searchable, accept });
  const pick = (next: StatusFilter): void => {
    setStatus(next);
    list.setPage(1);
  };
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
            <ListToolbar label="Search runs" query={list.query} onQuery={list.setQuery} summary={list.narrowed ? `${list.matching} of ${runs.length} runs` : undefined}>
              <span className="runs-filter" role="group" aria-label="Filter by status">
                {FILTERS.map((f) => (
                  <button key={f.id} type="button" className="runs-filter__chip" aria-pressed={status === f.id} onClick={() => pick(f.id)}>
                    {f.label}
                  </button>
                ))}
              </span>
            </ListToolbar>
            {list.view.total === 0 ? (
              <p className="knit-panel__state">No run matches this filter.</p>
            ) : (
              <ul className="knit-panel__list runs-compact" aria-label="Runs" onKeyDown={moveFocus}>
                {list.view.items.map((item) => (
                  <li key={item.run.id}>
                    <RunRow item={item} active={item.run.id === selectedId} onSelect={onSelect} />
                  </li>
                ))}
              </ul>
            )}
            <Pager page={list.view} onPage={list.setPage} noun="runs" />
          </>
        )}
      </section>
    </>
  );
}

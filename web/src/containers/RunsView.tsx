import { useEffect, useState } from "react";
import type { Page } from "../lists/paginate";
import { ListToolbar } from "../molecules/ListToolbar";
import { Pager } from "../molecules/Pager";
import { RunRow } from "../molecules/RunRow";
import { moveFocus } from "../organisms/RunsList";
import type { RunListItem } from "../runs/types";
import { useRunsPage } from "../runs/useRuns";
import "./RunsView.css";

const PAGE_SIZE = 8;
/** How long the search waits after the last key before it asks the server. */
const SEARCH_DELAY_MS = 250;
type StatusFilter = "all" | RunListItem["run"]["status"];
const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "failed", label: "Failed" },
  { id: "passed", label: "Passed" },
];

interface Props {
  pollMs?: number;
  /** The run the view shows now. */
  selectedId?: string | undefined;
  /** Makes a run the one the view shows; `undefined` goes back to the most recent run. */
  onSelect: (runId: string | undefined) => void;
}

/**
 * Container: the runs picker, newest first. The server pages, searches and filters, so a project with thousands of
 * runs reads eight at a time. Runs are not started here: a plan is drafted in Claude and sent from there.
 */
export function RunsView({ pollMs, selectedId, onSelect }: Props) {
  const [text, setText] = useState("");
  /** The search the server is asked for: the text, once the person stops typing. */
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [pageNo, setPageNo] = useState(1);
  const { runs, total, error, reload } = useRunsPage({ limit: PAGE_SIZE, offset: (pageNo - 1) * PAGE_SIZE, ...(q === "" ? {} : { q }), ...(status === "all" ? {} : { status }) }, pollMs);
  useEffect(() => {
    if (text.trim() === q) return;
    const timer = window.setTimeout(() => {
      setQ(text.trim());
      setPageNo(1);
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text, q]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Runs that left the list while the person was on a later page: go back to the last page that exists.
  useEffect(() => {
    if (runs !== undefined && runs.length === 0 && total > 0 && pageNo > pages) setPageNo(pages);
  }, [runs, total, pageNo, pages]);
  const view: Page<unknown> = { items: runs ?? [], page: pageNo, pages, total, from: total === 0 ? 0 : (pageNo - 1) * PAGE_SIZE + 1, to: (pageNo - 1) * PAGE_SIZE + (runs?.length ?? 0) };
  const narrowed = q !== "" || status !== "all";
  const pick = (next: StatusFilter): void => {
    setStatus(next);
    setPageNo(1);
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
        ) : total === 0 && !narrowed ? (
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
            <ListToolbar label="Search runs" query={text} onQuery={setText} summary={narrowed ? `${total} ${total === 1 ? "match" : "matches"}` : undefined}>
              <span className="runs-filter" role="group" aria-label="Filter by status">
                {FILTERS.map((f) => (
                  <button key={f.id} type="button" className="runs-filter__chip" aria-pressed={status === f.id} onClick={() => pick(f.id)}>
                    {f.label}
                  </button>
                ))}
              </span>
            </ListToolbar>
            {total === 0 ? (
              <p className="knit-panel__state">No run matches this filter.</p>
            ) : (
              <ul className="knit-panel__list runs-compact" aria-label="Runs" onKeyDown={moveFocus}>
                {runs.map((item) => (
                  <li key={item.run.id}>
                    <RunRow item={item} active={item.run.id === selectedId} onSelect={onSelect} />
                  </li>
                ))}
              </ul>
            )}
            <Pager page={view} onPage={setPageNo} noun="runs" />
          </>
        )}
      </section>
    </>
  );
}

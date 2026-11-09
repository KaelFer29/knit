import type { KeyboardEvent } from "react";
import { RunRow } from "../molecules/RunRow";
import type { RunListItem } from "../runs/types";
import "./RunsList.css";

interface Props {
  runs: RunListItem[] | undefined;
  error: string | undefined;
  onRetry: () => void;
}

/** Moves focus between the run links with the arrow keys, Home and End. Enter opens the focused link natively. */
export function moveFocus(event: KeyboardEvent<HTMLElement>): void {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const links = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-run-link]"));
  if (links.length === 0) return;
  const at = links.indexOf(document.activeElement as HTMLElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? links.length - 1 : event.key === "ArrowDown" ? Math.min(links.length - 1, at + 1) : Math.max(0, at - 1);
  event.preventDefault();
  links[next]?.focus();
}

/** Every run, newest first, with the loading, empty and error states. */
export function RunsList({ runs, error, onRetry }: Props) {
  if (runs === undefined && error !== undefined) {
    return (
      <div className="runs-list__state" role="alert">
        <p>Could not load the runs: {error}</p>
        <button type="button" className="runs-list__button" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  if (runs === undefined) return <p className="runs-list__state" role="status">Loading runs…</p>;
  if (runs.length === 0) {
    return (
      <div className="runs-list__state">
        <p className="runs-list__title">No runs yet</p>
        <p>Start one from a plan file above, or run <code>knit run &lt;plan.md&gt;</code> in a terminal; it will appear here.</p>
      </div>
    );
  }
  return (
    <>
      {error === undefined ? null : (
        <p className="runs-list__warn" role="status">
          Could not refresh: {error}
        </p>
      )}
      <ul className="runs-list" aria-label="Runs" onKeyDown={moveFocus}>
        {runs.map((item) => (
          <li key={item.run.id}>
            <RunRow item={item} />
          </li>
        ))}
      </ul>
    </>
  );
}

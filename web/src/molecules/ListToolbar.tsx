import type { ReactNode } from "react";
import "./ListToolbar.css";

interface Props {
  /** Accessible name and placeholder of the search box. */
  label: string;
  query: string;
  onQuery: (query: string) => void;
  /** A short count such as "3 of 9 runs", shown when the list is narrowed. */
  summary?: string | undefined;
  /** Extra filters, for example status chips. */
  children?: ReactNode;
}

/** The search box of a list, its filters and a one-line count. */
export function ListToolbar({ label, query, onQuery, summary, children }: Props) {
  return (
    <div className="list-toolbar">
      <input type="search" className="list-toolbar__search" aria-label={label} placeholder={label} value={query} onChange={(e) => onQuery(e.target.value)} />
      {children}
      {summary === undefined ? null : <span className="list-toolbar__summary">{summary}</span>}
    </div>
  );
}

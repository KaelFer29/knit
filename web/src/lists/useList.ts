import { useMemo, useState } from "react";
import { matchesQuery, paginate, type Page } from "./paginate";

interface Options<T> {
  items: readonly T[];
  pageSize: number;
  /** The text fields the search box looks into. */
  fields: (item: T) => (string | undefined)[];
  /** An extra filter (for example a status), applied before the search. */
  accept?: (item: T) => boolean;
}

export interface ListState<T> {
  query: string;
  setQuery: (query: string) => void;
  setPage: (page: number) => void;
  /** The page shown, after the filters. */
  view: Page<T>;
  /** How many items pass the filters. */
  matching: number;
  /** True when a search or filter is hiding something. */
  narrowed: boolean;
}

/** Search, filter and page state for a list. Changing the search goes back to the first page. */
export function useList<T>({ items, pageSize, fields, accept }: Options<T>): ListState<T> {
  const [query, setQueryState] = useState("");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => items.filter((item) => (accept?.(item) ?? true) && matchesQuery(fields(item), query)), [items, accept, fields, query]);
  const view = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize]);
  return {
    query,
    setQuery: (next) => {
      setQueryState(next);
      setPage(1);
    },
    setPage,
    view,
    matching: filtered.length,
    narrowed: filtered.length !== items.length,
  };
}

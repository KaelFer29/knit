export interface Page<T> {
  items: T[];
  /** The page shown, 1-based, already clamped to a valid one. */
  page: number;
  pages: number;
  total: number;
  /** 1-based position of the first and last item shown; both 0 when there are none. */
  from: number;
  to: number;
}

/** One page of a list. A page out of range becomes the nearest valid one, so a shrinking list never shows nothing. */
export function paginate<T>(items: readonly T[], page: number, size: number): Page<T> {
  const per = Math.max(1, Math.floor(size));
  const pages = Math.max(1, Math.ceil(items.length / per));
  const current = Math.min(pages, Math.max(1, Math.floor(page)));
  const start = (current - 1) * per;
  const slice = items.slice(start, start + per);
  return { items: slice, page: current, pages, total: items.length, from: slice.length === 0 ? 0 : start + 1, to: start + slice.length };
}

const fold = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** True when every word of the query appears in at least one field; a blank query matches everything. Case and accents do not matter. */
export function matchesQuery(fields: readonly (string | undefined)[], query: string): boolean {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = fields.map((f) => fold(f ?? "")).join("\n");
  return terms.every((term) => haystack.includes(term));
}

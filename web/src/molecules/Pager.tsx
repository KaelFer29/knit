import type { Page } from "../lists/paginate";
import "./Pager.css";

interface Props {
  page: Page<unknown>;
  onPage: (page: number) => void;
  /** What the items are, for the count: "runs", "branches". */
  noun: string;
}

/** Previous and next buttons with the range shown. Nothing is rendered when everything fits in one page. */
export function Pager({ page, onPage, noun }: Props) {
  if (page.pages <= 1) return null;
  return (
    <nav className="pager" aria-label={`Pages of ${noun}`}>
      <span className="pager__range" role="status">
        {page.from}–{page.to} of {page.total} {noun}
      </span>
      <span className="pager__buttons">
        <button type="button" className="pager__button" aria-label="Previous page" disabled={page.page <= 1} onClick={() => onPage(page.page - 1)}>
          ‹
        </button>
        <span className="pager__at" aria-hidden="true">
          {page.page}/{page.pages}
        </span>
        <button type="button" className="pager__button" aria-label="Next page" disabled={page.page >= page.pages} onClick={() => onPage(page.page + 1)}>
          ›
        </button>
      </span>
    </nav>
  );
}

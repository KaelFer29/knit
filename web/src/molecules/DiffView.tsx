import type { DiffItem } from "../config/diff";
import "./DiffView.css";

const SIGN = { same: " ", add: "+", del: "-" } as const;

/** Renders diff items as text (never as HTML). Added and removed lines carry a sign as well as a color. */
export function DiffView({ items, label = "Changes" }: { items: DiffItem[]; label?: string }) {
  return (
    <div className="diff" role="region" aria-label={label} tabIndex={0}>
      {items.map((item, index) =>
        item.kind === "skip" ? (
          <div key={index} className="diff__skip">
            {item.count} unchanged {item.count === 1 ? "line" : "lines"}
          </div>
        ) : (
          <div key={index} className="diff__row" data-kind={item.kind}>
            <span className="diff__num" aria-hidden="true">
              {item.oldNumber ?? ""}
            </span>
            <span className="diff__num" aria-hidden="true">
              {item.newNumber ?? ""}
            </span>
            <span className="diff__sign" aria-hidden="true">
              {SIGN[item.kind]}
            </span>
            <code className="diff__text">{item.text === "" ? " " : item.text}</code>
            {item.kind !== "same" ? <span className="sr-only">{item.kind === "add" ? "added" : "removed"}</span> : null}
          </div>
        ),
      )}
    </div>
  );
}

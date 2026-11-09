import type { ReactNode } from "react";
import "./DetailPanel.css";

interface Props {
  id: string;
  /** Accessible name of the panel, for example "Detail of T3". */
  label: string;
  /** What a later task renders here. Nothing at all shows the empty state. */
  children?: ReactNode;
}

/** The panel a disclosure widget opens. It is mounted only while open. */
export function DetailPanel({ id, label, children }: Props) {
  const empty = children === undefined || children === null || children === false;
  return (
    <div className="detail-panel" id={id} role="region" aria-label={label}>
      {empty ? (
        <p className="detail-panel__empty">
          <span className="detail-panel__title">No detail to show yet</span>
          <span className="detail-panel__hint">Attempts, checks and the timeline will open here.</span>
        </p>
      ) : (
        children
      )}
    </div>
  );
}

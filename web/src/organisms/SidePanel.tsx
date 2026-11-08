import { useEffect, useId, useRef, type ReactNode } from "react";
import "./SidePanel.css";

interface Props {
  /** Identifies the trigger (`data-panel-trigger`) that gets the focus back when the panel closes. */
  panelId: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Side panel frame. It is a non-modal dialog: the pipeline behind it stays visible, animated and reachable.
 * Focus moves into the panel when it opens, Escape closes it, and the focus returns to the block (or button) that
 * opened it. The body is whatever the panel registry renders.
 */
export function SidePanel({ panelId, title, onClose, children }: Props) {
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !e.defaultPrevented) closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const trigger = document.querySelector<HTMLElement>(`[data-panel-trigger="${panelId}"]`);
      trigger?.focus();
    };
  }, [panelId]);

  return (
    <aside ref={ref} className="side-panel" role="dialog" aria-modal="false" aria-labelledby={titleId} tabIndex={-1}>
      <header className="side-panel__head">
        <h2 id={titleId} className="side-panel__title">
          {title}
        </h2>
        <button type="button" className="side-panel__close" onClick={onClose} aria-label={`Close ${title}`}>
          Close
        </button>
      </header>
      <div className="side-panel__body">{children}</div>
    </aside>
  );
}

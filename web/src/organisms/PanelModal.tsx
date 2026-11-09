import { useEffect, useId, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Logo } from "../atoms/Logo";
import type { AgentIdentity } from "../identity/agents";
import "./PanelModal.css";

interface Props {
  /** Identifies the trigger (`data-panel-trigger`) that the modal grows from and that gets the focus back on close. */
  panelId: string;
  title: string;
  /** The agent the modal belongs to; it brings its brand into the header. Absent for the configuration. */
  identity?: AgentIdentity | undefined;
  onClose: () => void;
  children: ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal frame over the single view. It grows from the block that opened it, dims the pipeline behind it, keeps the
 * Tab key inside, closes on Escape, on the Close button and on a click outside, and gives the focus back to the block.
 * The body is whatever the panel registry renders.
 */
export function PanelModal({ panelId, title, identity, onClose, children }: Props) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Grow from the trigger: the animation's origin is the middle of the block that was clicked.
  useLayoutEffect(() => {
    const dialog = ref.current;
    const trigger = document.querySelector<HTMLElement>(`[data-panel-trigger="${panelId}"]`);
    if (dialog === null || trigger === null) return;
    const from = trigger.getBoundingClientRect();
    const to = dialog.getBoundingClientRect();
    dialog.style.setProperty("--origin-x", `${from.left + from.width / 2 - to.left}px`);
    dialog.style.setProperty("--origin-y", `${from.top + from.height / 2 - to.top}px`);
  }, [panelId]);

  useEffect(() => {
    ref.current?.focus();
    const trigger = document.querySelector<HTMLElement>(`[data-panel-trigger="${panelId}"]`);
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === "Escape" && !e.defaultPrevented) closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [panelId]);

  const onTab = (e: KeyboardEvent): void => {
    if (e.key !== "Tab") return;
    const dialog = ref.current;
    if (dialog === null) return;
    const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getAttribute("aria-hidden") !== "true");
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const style = identity === undefined ? undefined : ({ "--modal-accent": identity.accent, "--modal-soft": identity.accentSoft } as CSSProperties);
  return (
    <div className="modal" data-testid="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="modal__dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-agent={identity?.id} data-skin={identity?.skin} style={style} onKeyDown={onTab}>
        <div className="modal__head">
          {identity === undefined ? null : <Logo identity={identity} size={28} />}
          <h2 id={titleId} className="modal__title">
            {title}
          </h2>
          {identity === undefined ? null : <span className="modal__tagline">{identity.tagline}</span>}
          <button type="button" className="modal__close" onClick={onClose} aria-label={`Close ${title}`}>
            <span aria-hidden="true">✕</span>
            <span className="modal__close-text">Close</span>
          </button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}

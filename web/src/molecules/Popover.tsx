import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import "./Popover.css";

interface Props {
  /** Accessible name of the trigger button and of the popover itself. */
  label: string;
  /** What the trigger shows. */
  trigger: ReactNode;
  /** Opens above (default, for the composer) or below its trigger. */
  direction?: "up" | "down";
  align?: "start" | "end";
  triggerClassName?: string;
  /** Lets the container open or focus the trigger (the `/model` command). */
  triggerRef?: RefObject<HTMLButtonElement | null>;
  children: ReactNode | ((api: { close: () => void }) => ReactNode);
}

/**
 * A small non-modal popover. It closes on Escape (without closing the modal around it), on a click outside and when a
 * choice calls `close`, and gives the focus back to its trigger.
 */
export function Popover({ label, trigger, direction = "up", align = "start", triggerClassName, triggerRef, children }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const own = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      // Capture phase: the modal's own Escape handler must not see this key.
      e.stopPropagation();
      setOpen(false);
      (triggerRef?.current ?? own.current)?.focus();
    };
    const onDown = (e: MouseEvent): void => {
      if (root.current !== null && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, triggerRef]);

  return (
    <div ref={root} className="popover" data-open={open || undefined}>
      <button
        ref={(el) => {
          own.current = el;
          if (triggerRef) triggerRef.current = el;
        }}
        type="button"
        className={triggerClassName ?? "popover__trigger"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </button>
      {open ? (
        <div ref={panel} id={id} className="popover__panel" data-direction={direction} data-align={align} role="dialog" aria-label={label} tabIndex={-1}>
          {typeof children === "function" ? children({ close }) : children}
        </div>
      ) : null}
    </div>
  );
}

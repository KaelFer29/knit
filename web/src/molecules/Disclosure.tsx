import type { ReactNode } from "react";
import { Chevron } from "../atoms/Chevron";
import { useDisclosure } from "../flow/useDisclosure";
import "./Disclosure.css";

interface Props {
  title: ReactNode;
  /** Small text at the right of the title, for example a count. */
  meta?: ReactNode;
  defaultOpen?: boolean;
  /** Rendered only while open, so lazy content costs nothing while closed. */
  children: ReactNode;
}

/** A nested expandable section inside a detail panel. */
export function Disclosure({ title, meta, defaultOpen = false, children }: Props) {
  const { open, panelId, triggerProps } = useDisclosure(defaultOpen);
  return (
    <section className="disclosure">
      <button className="disclosure__trigger" {...triggerProps}>
        <span className="disclosure__title">{title}</span>
        {meta === undefined ? null : <span className="disclosure__meta">{meta}</span>}
        <Chevron />
      </button>
      {open ? (
        <div className="disclosure__body" id={panelId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

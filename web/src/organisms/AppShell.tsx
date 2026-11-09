import type { ReactNode } from "react";
import { AGENTS } from "../identity/agents";
import { Logo } from "../atoms/Logo";
import "./AppShell.css";

interface Props {
  /** Main navigation, next to the brand. */
  nav?: ReactNode;
  /** Name of the main area for assistive technology. */
  label?: string;
  /** Controls on the right of the header (the theme toggle). */
  actions?: ReactNode;
  /** The canvas. */
  children: ReactNode;
}

/** Page frame: header with Knit's mark and name, and the main area that hosts the canvas. */
export function AppShell({ nav, label = "Run canvas", actions, children }: Props) {
  return (
    <div className="shell">
      <a className="shell__skip" href="#canvas">
        Skip to content
      </a>
      <header className="shell__header">
        <div className="shell__brand">
          <Logo identity={AGENTS.knit} size={32} />
          <span className="shell__name">Knit</span>
        </div>
        {nav}
        <div className="shell__actions">{actions}</div>
      </header>
      <main id="canvas" className="shell__main" aria-label={label}>
        {children}
      </main>
    </div>
  );
}

import type { ReactNode } from "react";
import { AGENTS } from "../identity/agents";
import { Logo } from "../atoms/Logo";
import "./AppShell.css";

interface Props {
  /** Main navigation, next to the brand. */
  nav?: ReactNode;
  /** Name of the main area for assistive technology. */
  label?: string;
  /** Where the agents work, shown once in the header for all of them. */
  workspace?: string | undefined;
  /** Controls on the right of the header. */
  actions?: ReactNode;
  /** The canvas. */
  children: ReactNode;
}

/** Page frame: header with Knit's mark and name, and the main area that hosts the canvas. */
export function AppShell({ nav, label = "Run canvas", workspace, actions, children }: Props) {
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
        {workspace === undefined ? null : (
          <span className="shell__workspace" title="Where Knit was launched; agents work here">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
            </svg>
            <span className="shell__workspace-path">{workspace}</span>
          </span>
        )}
        <div className="shell__actions">{actions}</div>
      </header>
      <main id="canvas" className="shell__main" aria-label={label}>
        {children}
      </main>
    </div>
  );
}

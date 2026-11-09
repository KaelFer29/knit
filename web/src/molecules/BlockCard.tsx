import type { CSSProperties, ReactNode } from "react";
import { Logo } from "../atoms/Logo";
import { StatusBadge } from "../atoms/StatusBadge";
import { NODE_STATUS_LABEL, NODE_STATUS_TONE } from "../flow/status";
import type { AgentIdentity } from "../identity/agents";
import type { BlockView, StageView } from "../single/pipeline";
import "./BlockCard.css";

interface Props {
  identity: AgentIdentity;
  view: BlockView;
  /** The orchestrator's own stages; only the pipeline skin draws them. */
  stages?: StageView[];
  open: boolean;
  onOpen: () => void;
}

/** Claude Code's terminal mascot, drawn with block characters the way the CLI prints it. */
const MASCOT = [" ▐▛███▜▌", "▝▜█████▛▘", "  ▘▘ ▝▝"];

const STAGE_ICON: Record<StageView["status"], string> = { idle: "", active: "", done: "✓", failed: "✕" };

/**
 * One of the three blocks, drawn in its identity's skin: Claude as a Claude Code terminal (with its mascot on top),
 * the orchestrator as a pipeline of stages, Cursor as an editor window. The card is a labelled group; its open button
 * stretches over the whole card, so a click anywhere opens the block.
 */
export function BlockCard({ identity, view, stages, open, onOpen }: Props) {
  const style = { "--block-accent": identity.accent, "--block-soft": identity.accentSoft } as CSSProperties;
  const badge = <StatusBadge state={NODE_STATUS_TONE[view.status]} label={NODE_STATUS_LABEL[view.status]} />;
  const openButton = (children: ReactNode, className: string) => (
    <button type="button" className={`block__open ${className}`} data-panel-trigger={identity.id} aria-haspopup="dialog" aria-expanded={open} onClick={onOpen}>
      {children}
    </button>
  );

  return (
    <article className="block" role="group" aria-label={identity.label} data-skin={identity.skin} data-agent={identity.id} data-status={view.status} style={style}>
      {identity.skin === "terminal" ? (
        <span className="block__mascot" aria-hidden="true">
          {MASCOT.map((row) => (
            <span key={row}>{row}</span>
          ))}
        </span>
      ) : null}
      <div className="block__frame">
        {identity.skin === "terminal" ? (
          <>
            <div className="block__bar">
              <span className="term__spark" aria-hidden="true">
                ✻
              </span>
              <span className="block__who">
                <span className="block__name">{identity.label}</span>
                <span className="block__tagline">{identity.tagline}</span>
              </span>
              {badge}
            </div>
            <p className="term__prompt" title={view.headline}>
              <span aria-hidden="true">&gt; </span>
              {view.headline}
            </p>
            <Lines identity={identity} view={view} marker="⏺" />
            {view.status === "working" ? <p className="term__working">✻ Working…</p> : null}
            {openButton(
              <>
                <span>Open {identity.label}</span>
                <span className="term__enter" aria-hidden="true">
                  ↵
                </span>
              </>,
              "term__input",
            )}
          </>
        ) : identity.skin === "pipeline" ? (
          <>
            <div className="block__bar">
              <PipelineMark />
              <span className="block__who">
                <span className="block__name">{identity.label}</span>
                <span className="block__tagline">{identity.tagline}</span>
              </span>
              {badge}
            </div>
            <p className="pipe__plan" title={view.headline}>
              {view.headline}
            </p>
            {stages !== undefined ? (
              <ol className="pipe__stages" aria-label="Orchestrator stages">
                {stages.map((s) => (
                  <li key={s.id} className="pipe__stage" data-status={s.status}>
                    <span className="pipe__dot" aria-hidden="true">
                      {STAGE_ICON[s.status]}
                    </span>
                    <span className="pipe__label">{s.label}</span>
                    {s.detail !== undefined ? <span className="pipe__detail">{s.detail}</span> : null}
                    <span className="sr-only">, {s.status}</span>
                  </li>
                ))}
              </ol>
            ) : null}
            <Lines identity={identity} view={view} />
            {openButton(<>Open {identity.label} <span aria-hidden="true">→</span></>, "pipe__open")}
          </>
        ) : (
          <>
            <div className="block__bar">
              <Logo identity={identity} size={22} />
              <span className="block__who">
                <span className="block__name">{identity.label}</span>
                <span className="block__tagline">{identity.tagline}</span>
              </span>
              {badge}
            </div>
            <div className="editor__tabs" aria-hidden="true">
              <span className="editor__tab" title={view.headline}>
                {view.headline}
              </span>
            </div>
            <Lines identity={identity} view={view} numbered />
            {openButton(
              <>
                <span className="editor__branch" aria-hidden="true">
                  ⎇
                </span>
                <span>Open {identity.label}</span>
                <span className="editor__state" aria-hidden="true">{NODE_STATUS_LABEL[view.status]}</span>
              </>,
              "editor__status",
            )}
          </>
        )}
      </div>
    </article>
  );
}

/** The latest actions, newest first. `edit:` lines read as additions in the editor skin. */
function Lines({ identity, view, marker, numbered }: { identity: AgentIdentity; view: BlockView; marker?: string; numbered?: boolean }) {
  return (
    <ol className="block__lines" role="log" aria-label={`${identity.label} latest actions`} aria-live="off">
      {view.lines.length === 0 ? (
        <li className="block__line block__line--empty">Nothing yet</li>
      ) : (
        view.lines.map((line, i) => (
          <li key={`${i}-${line}`} className="block__line" data-edit={numbered && /^(edit|write|create)\b/i.test(line) ? "true" : undefined} title={line} style={{ "--i": i } as CSSProperties}>
            {numbered ? (
              <span className="block__gutter" aria-hidden="true">
                {i + 1}
              </span>
            ) : marker !== undefined ? (
              <span className="block__marker" aria-hidden="true">
                {marker}
              </span>
            ) : null}
            <span className="block__text">{line}</span>
          </li>
        ))
      )}
    </ol>
  );
}

/** The orchestrator's mark: three stages joined by a line, drawn in code. */
function PipelineMark() {
  return (
    <svg className="pipe__mark" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="4.5" cy="12" r="2.6" fill="currentColor" />
      <circle cx="12" cy="12" r="2.6" fill="var(--surface-1)" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="19.5" cy="12" r="2.6" fill="currentColor" />
    </svg>
  );
}

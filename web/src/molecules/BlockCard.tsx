import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { ClaudeMascot } from "../atoms/ClaudeMascot";
import { Logo } from "../atoms/Logo";
import { StatusBadge } from "../atoms/StatusBadge";
import { NODE_STATUS_LABEL, NODE_STATUS_TONE } from "../flow/status";
import type { AgentIdentity } from "../identity/agents";
import type { BlockDetails, BlockView, StageView } from "../single/pipeline";
import "./BlockCard.css";

interface Props {
  identity: AgentIdentity;
  view: BlockView;
  details: BlockDetails;
  /** The orchestrator's own stages; only the pipeline skin draws them. */
  stages?: StageView[];
  open: boolean;
  onOpen: () => void;
}

const STAGE_ICON: Record<StageView["status"], string> = { idle: "", active: "", done: "✓", failed: "✕" };

const EDIT_LINE = /^(edit|write|create)\b:?\s*/i;

/**
 * One of the three blocks, drawn in its identity's skin: Claude in claude.ai's ivory and serif with a Claude Code
 * terminal inside (and its mascot on top), the orchestrator as a pipeline of stages, Cursor as its dark agent panel.
 * The card is a labelled group; its open button stretches over the whole card. A separate "Details" toggle expands
 * the block's facts in a sheet below it without opening anything.
 */
export function BlockCard({ identity, view, details, stages, open, onOpen }: Props) {
  const [expanded, setExpanded] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sheetId = useId();
  const style = { "--block-accent": identity.accent, "--block-soft": identity.accentSoft } as CSSProperties;
  const badge = <StatusBadge state={NODE_STATUS_TONE[view.status]} label={NODE_STATUS_LABEL[view.status]} />;
  const openButton = (children: ReactNode, className: string) => (
    <button type="button" className={`block__open ${className}`} data-panel-trigger={identity.id} aria-haspopup="dialog" aria-expanded={open} onClick={onOpen}>
      {children}
    </button>
  );
  const onSheetKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    setExpanded(false);
    toggleRef.current?.focus();
  };
  const footer = (openLabel: ReactNode, openClass: string) => (
    <div className="block__foot">
      {openButton(openLabel, openClass)}
      <button ref={toggleRef} type="button" className="block__toggle" aria-label={`${identity.label} details`} aria-expanded={expanded} aria-controls={sheetId} onClick={() => setExpanded((v) => !v)}>
        Details
        <span className="block__chevron" aria-hidden="true">
          ▾
        </span>
      </button>
    </div>
  );

  return (
    <article className="block" role="group" aria-label={identity.label} data-skin={identity.skin} data-agent={identity.id} data-status={view.status} data-expanded={expanded || undefined} style={style}>
      {identity.skin === "terminal" ? (
        <ClaudeMascot className="block__mascot" />
      ) : null}
      <div className="block__frame">
        {identity.skin === "terminal" ? (
          <>
            <div className="block__bar">
              <span className="claude__spark" aria-hidden="true">
                ✻
              </span>
              <span className="block__who">
                <span className="block__name">{identity.label}</span>
                <span className="block__tagline">{identity.tagline}</span>
              </span>
              {badge}
            </div>
            <p className="claude__title" title={view.headline}>
              {view.headline}
            </p>
            <div className="claude__term">
              <Lines identity={identity} view={view} render={(line, i) => (i === 0 ? <><span className="claude__dot" aria-hidden="true">⏺</span><span className="block__text">{line}</span></> : <><span className="claude__elbow" aria-hidden="true">⎿</span><span className="block__text">{line}</span></>)} />
              {view.status === "working" ? (
                <p className="claude__spinner">
                  <span className="claude__glyph" aria-hidden="true" />
                  Cogitating… <span className="claude__hint">(esc to interrupt)</span>
                </p>
              ) : null}
            </div>
            {footer(
              <>
                <span className="claude__caret" aria-hidden="true">
                  &gt;
                </span>
                Open {identity.label}
              </>,
              "claude__input",
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
            {stages !== undefined ? <Stages stages={stages} /> : null}
            <Lines identity={identity} view={view} render={(line) => <span className="block__text">{line}</span>} />
            {footer(<>Open {identity.label}</>, "pipe__open")}
          </>
        ) : (
          <>
            <div className="block__bar">
              <Logo identity={identity} size={20} />
              <span className="block__who">
                <span className="block__name">{identity.label}</span>
                <span className="cursor__mode" aria-hidden="true">
                  ∞ Agent
                </span>
              </span>
              {badge}
            </div>
            <p className="cursor__task" title={view.headline}>
              {view.headline}
            </p>
            <Lines
              identity={identity}
              view={view}
              render={(line) => {
                const edit = EDIT_LINE.test(line);
                if (!edit) return <span className="block__text">{line}</span>;
                const path = line.replace(EDIT_LINE, "");
                const cut = path.lastIndexOf("/");
                return (
                  <>
                    <span className="cursor__file" aria-hidden="true">
                      ✎
                    </span>
                    <span className="block__text">
                      <strong>{path.slice(cut + 1)}</strong> <span className="cursor__dir">{path.slice(0, cut + 1)}</span>
                    </span>
                    <span className="cursor__edited">Edited</span>
                  </>
                );
              }}
            />
            {footer(
              <>
                <span>Open {identity.label}</span>
                <span className="cursor__enter" aria-hidden="true">
                  ⏎
                </span>
              </>,
              "cursor__input",
            )}
          </>
        )}
      </div>
      {expanded ? (
        <section id={sheetId} className="block__sheet" role="region" aria-label={`${identity.label} details`} onKeyDown={onSheetKey}>
          <dl className="sheet__facts">
            {details.facts.map((f) => (
              <div key={f.label} className="sheet__fact">
                <dt>{f.label}</dt>
                <dd title={f.value}>{f.value}</dd>
              </div>
            ))}
          </dl>
          {details.meters.map((m) => (
            <div key={m.label} className="sheet__meter">
              <span className="sheet__meter-label">
                {m.label}
                <span>{Math.round(m.ratio * 100)}%</span>
              </span>
              <span className="sheet__bar" role="meter" aria-label={m.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(m.ratio * 100)}>
                <span style={{ width: `${m.ratio * 100}%` }} />
              </span>
            </div>
          ))}
          {identity.skin === "terminal" ? (
            <div className="sheet__agents">
              <p className="sheet__heading">Active agents</p>
              {details.agents.length === 0 ? (
                <p className="sheet__none">None running</p>
              ) : (
                <ul>
                  {details.agents.map((a, i) => (
                    <li key={`${i}-${a}`}>{a}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
          <button type="button" className="sheet__action" onClick={onOpen}>
            {identity.skin === "pipeline" ? "Manage the run" : "Change model or session"}
          </button>
        </section>
      ) : null}
    </article>
  );
}

/** The latest actions, newest first, each drawn by the skin. */
function Lines({ identity, view, render }: { identity: AgentIdentity; view: BlockView; render: (line: string, i: number) => ReactNode }) {
  return (
    <ol className="block__lines" role="log" aria-label={`${identity.label} latest actions`} aria-live="off">
      {view.lines.length === 0 ? (
        <li className="block__line block__line--empty">Nothing yet</li>
      ) : (
        view.lines.map((line, i) => (
          <li key={`${i}-${line}`} className="block__line" title={line} style={{ "--i": i } as CSSProperties}>
            {render(line, i)}
          </li>
        ))
      )}
    </ol>
  );
}

/** The orchestrator's stages as a horizontal track, like a delivery pipeline. */
function Stages({ stages }: { stages: StageView[] }) {
  // The stage to spell out: a failure first, then the work in hand (checks, then build), then whatever is next.
  const pick = (id: StageView["id"]) => stages.find((s) => s.id === id && s.status === "active");
  const current = stages.find((s) => s.status === "failed") ?? pick("checks") ?? pick("build") ?? stages.find((s) => s.status === "active") ?? stages.find((s) => s.status !== "done");
  return (
    <>
      <ol className="pipe__stages" aria-label="Orchestrator stages">
        {stages.map((s) => (
          <li key={s.id} className="pipe__stage" data-status={s.status}>
            <span className="pipe__dot" aria-hidden="true">
              {STAGE_ICON[s.status]}
            </span>
            <span className="pipe__label">{s.label}</span>
            <span className="sr-only">
              , {s.status}
              {s.detail !== undefined ? `, ${s.detail}` : ""}
            </span>
          </li>
        ))}
      </ol>
      {current?.detail !== undefined ? (
        <p className="pipe__now" aria-hidden="true">
          {current.label} · {current.detail}
        </p>
      ) : null}
    </>
  );
}

/** The orchestrator's mark: three stages joined by a line, drawn in code. */
function PipelineMark() {
  return (
    <svg className="pipe__mark" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="4.5" cy="12" r="2.6" fill="currentColor" />
      <circle cx="12" cy="12" r="2.6" fill="var(--surface-1)" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="19.5" cy="12" r="2.6" fill="currentColor" />
    </svg>
  );
}

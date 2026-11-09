import type { CSSProperties } from "react";
import { Logo } from "../atoms/Logo";
import { StatusBadge } from "../atoms/StatusBadge";
import { NODE_STATUS_LABEL, NODE_STATUS_TONE } from "../flow/status";
import type { AgentIdentity } from "../identity/agents";
import type { BlockView } from "../single/pipeline";
import "./BlockCard.css";

interface Props {
  identity: AgentIdentity;
  view: BlockView;
  open: boolean;
  onOpen: () => void;
}

/** One of the three blocks: its identity, live state and latest actions. The whole card opens the side panel. */
export function BlockCard({ identity, view, open, onOpen }: Props) {
  const style = { "--block-accent": identity.accent, "--block-soft": identity.accentSoft } as CSSProperties;
  return (
    <button type="button" className="block-card" style={style} data-agent={identity.id} data-status={view.status} data-panel-trigger={identity.id} aria-haspopup="dialog" aria-expanded={open} onClick={onOpen}>
      <span className="block-card__head">
        <Logo identity={identity} />
        <span className="block-card__who">
          <span className="block-card__name">{identity.label}</span>
          <span className="block-card__role">{identity.role}</span>
        </span>
        <StatusBadge state={NODE_STATUS_TONE[view.status]} label={NODE_STATUS_LABEL[view.status]} />
      </span>
      <span className="block-card__headline">{view.headline}</span>
      <span className="block-card__lines" role="log" aria-label={`${identity.label} latest actions`} aria-live="off">
        {view.lines.length === 0 ? <span className="block-card__line block-card__line--empty">Nothing yet</span> : view.lines.map((line, i) => <span key={`${i}-${line}`} className="block-card__line">{line}</span>)}
      </span>
      <span className="block-card__open" aria-hidden="true">
        Open details
      </span>
    </button>
  );
}

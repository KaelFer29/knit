import type { CSSProperties, ReactNode, Ref } from "react";
import type { LiveLine as LiveLineData, NodeStatus, TokenTotals } from "@board";
import { Chevron } from "../atoms/Chevron";
import { Logo } from "../atoms/Logo";
import { StatusBadge } from "../atoms/StatusBadge";
import type { RenderDetail } from "../flow/detail";
import { NODE_STATUS_LABEL, NODE_STATUS_TONE } from "../flow/status";
import { useDisclosure } from "../flow/useDisclosure";
import type { AgentIdentity } from "../identity/agents";
import { DetailPanel } from "../molecules/DetailPanel";
import { LiveLine } from "../molecules/LiveLine";
import { TokenStat } from "../molecules/TokenStat";
import "./AgentBlock.css";

interface Props {
  identity: AgentIdentity;
  status: NodeStatus;
  /** A line under the name: the plan, or progress. */
  summary?: ReactNode;
  /** Model usage. Omitted for a block that never calls a model. */
  tokens?: TokenTotals | undefined;
  /** Reserves a spot for the live line, which says what the agent is doing right now. */
  showLive?: boolean;
  liveLine?: LiveLineData | undefined;
  /** What the live spot says when there is no line. */
  idleText?: string | undefined;
  renderDetail?: RenderDetail | undefined;
  /** The block's own content, such as Knit's queue and delivery lane. */
  children?: ReactNode;
  /** The canvas measures the block to attach wires to its edges. */
  ref?: Ref<HTMLElement>;
}

/**
 * One of the three identity blocks. Its header is a disclosure button (`aria-expanded`) that opens a detail slot;
 * everything it shows comes from props, so it never branches on which agent it is.
 */
export function AgentBlock({ identity, status, summary, tokens, showLive = false, liveLine, idleText, renderDetail, children, ref }: Props) {
  const { open, panelId, triggerProps } = useDisclosure();
  const style = { "--block-accent": identity.accent, "--block-accent-soft": identity.accentSoft } as CSSProperties;

  return (
    <article className="agent-block" data-block={identity.id} data-status={status} style={style} ref={ref}>
      <h2 className="agent-block__heading">
        <button className="agent-block__trigger" {...triggerProps}>
          <span className="agent-block__logo">
            <Logo identity={identity} size={44} />
          </span>
          <span className="agent-block__badge">
            <StatusBadge state={NODE_STATUS_TONE[status]} label={NODE_STATUS_LABEL[status]} />
          </span>
          <span className="agent-block__label">{identity.label}</span>
          <span className="agent-block__chevron">
            <Chevron />
          </span>
          <span className="agent-block__role">{identity.role}</span>
        </button>
      </h2>
      {open ? (
        <DetailPanel id={panelId} label={`Detail of ${identity.label}`}>
          {renderDetail?.({ kind: "agent", id: identity.id })}
        </DetailPanel>
      ) : null}
      <div className="agent-block__body">
        {summary === undefined ? null : <div className="agent-block__summary">{summary}</div>}
        {tokens === undefined ? null : <TokenStat tokens={tokens} />}
        {showLive ? <LiveLine line={liveLine} idleText={idleText} /> : null}
        {children}
      </div>
    </article>
  );
}

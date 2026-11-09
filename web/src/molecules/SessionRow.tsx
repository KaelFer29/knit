import { Logo } from "../atoms/Logo";
import { formatTokens } from "../flow/format";
import type { AgentIdentity } from "../identity/agents";
import { formatAgo } from "../sessions/format";
import type { SessionListEntry } from "../sessions/types";
import "./SessionRow.css";

interface Props {
  entry: SessionListEntry;
  identity: AgentIdentity;
  selected: boolean;
  now: number;
  onSelect: (id: string) => void;
}

/** One session in the list: agent logo, title, and a quiet second line with when, how many turns and tokens. */
export function SessionRow({ entry, identity, selected, now, onSelect }: Props) {
  const { session } = entry;
  const tokens = entry.inputTokens + entry.outputTokens;
  const running = session.status === "running";
  return (
    <button type="button" className="session-row" aria-current={selected ? "true" : undefined} onClick={() => onSelect(session.id)}>
      <Logo identity={identity} size={24} />
      <span className="session-row__text">
        <span className="session-row__title">{session.title}</span>
        <span className="session-row__meta">
          {running ? <span className="session-row__running">Running</span> : <span>{formatAgo(session.updatedAt, now)}</span>}
          <span>
            {entry.turnCount} {entry.turnCount === 1 ? "turn" : "turns"}
          </span>
          {tokens > 0 ? <span>{formatTokens(tokens)} tokens</span> : null}
        </span>
      </span>
    </button>
  );
}

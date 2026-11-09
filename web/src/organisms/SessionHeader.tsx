import { Logo } from "../atoms/Logo";
import type { AgentIdentity } from "../identity/agents";
import { CopyCommand } from "../molecules/CopyCommand";
import type { Session } from "../sessions/types";
import "./SessionHeader.css";

interface Props {
  session: Session;
  identity: AgentIdentity;
  /** The terminal command that continues this session; absent when the agent cannot resume or has not reported its id yet. */
  continueCommand?: string;
  usageOpen: boolean;
  onToggleUsage: () => void;
}

/** Who the conversation is with, where it runs, and the way to carry on in a terminal. */
export function SessionHeader({ session, identity, continueCommand, usageOpen, onToggleUsage }: Props) {
  return (
    <header className="session-header">
      <div className="session-header__top">
        <Logo identity={identity} size={32} />
        <div className="session-header__text">
          <h2 className="session-header__title">{session.title}</h2>
          <span className="session-header__sub">
            {identity.label} · <span className="session-header__cwd">{session.cwd}</span>
          </span>
        </div>
        <button type="button" className="session-header__toggle" aria-expanded={usageOpen} onClick={onToggleUsage}>
          Usage
        </button>
      </div>
      {continueCommand ? <CopyCommand command={continueCommand} /> : null}
    </header>
  );
}

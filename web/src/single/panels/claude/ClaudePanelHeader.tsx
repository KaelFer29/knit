import { Popover } from "../../../molecules/Popover";
import { formatAgo } from "../../../sessions/format";
import type { AgentView, Session, SessionListEntry } from "../../../sessions/types";
import "./ClaudePanelHeader.css";

interface Props {
  /** Only this agent's sessions. */
  sessions: SessionListEntry[];
  /** The open session's id; undefined while a new conversation is open. */
  selectedId: string | undefined;
  session: Session | undefined;
  agent: AgentView | undefined;
  now: number;
  onSelect: (id: string) => void;
  onNew: () => void;
}

const icon = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

/** The conversation's title and folder, with a history menu to switch conversations and a button to start another. */
export function ClaudePanelHeader({ sessions, selectedId, session, agent, now, onSelect, onNew }: Props) {
  return (
    <header className="claude-head">
      <div className="claude-head__title">
        <h3 className="claude-head__name">{session?.title ?? "New conversation"}</h3>
        {session?.status === "running" ? <span className="claude-head__live">Working</span> : null}
        {session ? (
          <span className="claude-head__cwd" title={session.cwd}>
            {session.cwd}
          </span>
        ) : agent ? (
          <span className="claude-head__cwd">{agent.label}</span>
        ) : null}
      </div>
      <div className="claude-head__tools">
        <Popover
          label="Conversation history"
          direction="down"
          align="end"
          triggerClassName="claude-head__icon"
          trigger={
            <svg {...icon}>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          }
        >
          {({ close }) =>
            sessions.length === 0 ? (
              <p className="claude-head__none">No conversations yet.</p>
            ) : (
              <ul className="claude-head__list">
                {sessions.map(({ session: s }) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="claude-head__item"
                      data-current={s.id === selectedId}
                      onClick={() => {
                        onSelect(s.id);
                        close();
                      }}
                    >
                      <span className="claude-head__item-title">{s.title}</span>
                      <span className="claude-head__item-meta">{s.status === "running" ? "Working" : formatAgo(s.updatedAt, now)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          }
        </Popover>
        <button type="button" className="claude-head__icon" aria-label="New session" title="New session" onClick={onNew}>
          <svg {...icon}>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
    </header>
  );
}

import { identityOf } from "../identity/agents";
import { SessionRow } from "../molecules/SessionRow";
import type { AgentView, SessionListEntry } from "../sessions/types";
import "./SessionList.css";

interface Props {
  sessions: SessionListEntry[];
  agents: AgentView[];
  selectedId: string | undefined;
  now: number;
  onSelect: (id: string) => void;
  onNew: () => void;
}

/** Every session of every agent, most recent first, with the way to start a new one. */
export function SessionList({ sessions, agents, selectedId, now, onSelect, onNew }: Props) {
  const labelOf = (id: string): string | undefined => agents.find((a) => a.id === id)?.label;
  return (
    <section className="session-list" aria-label="Sessions">
      <div className="session-list__head">
        <h2 className="session-list__title">Sessions</h2>
        <button type="button" className="session-list__new" onClick={onNew}>
          New session
        </button>
      </div>
      {sessions.length === 0 ? (
        <p className="session-list__empty">No sessions yet. Start one and it will be kept here.</p>
      ) : (
        <ul className="session-list__items">
          {sessions.map((entry) => (
            <li key={entry.session.id}>
              <SessionRow
                entry={entry}
                identity={identityOf(entry.session.agent, labelOf(entry.session.agent))}
                selected={entry.session.id === selectedId}
                now={now}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

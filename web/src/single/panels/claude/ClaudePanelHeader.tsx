import { useId } from "react";
import { Logo } from "../../../atoms/Logo";
import { identityOf } from "../../../identity/agents";
import type { AgentView, Profile, Session, SessionListEntry } from "../../../sessions/types";
import "./ClaudePanelHeader.css";

interface Props {
  sessions: SessionListEntry[];
  agents: AgentView[];
  /** The open session's id; undefined while the new-session form is open. */
  selectedId: string | undefined;
  session: Session | undefined;
  agent: AgentView | undefined;
  /** The per-turn choices the composer holds for this agent (model, effort, ...). */
  profile: Profile;
  onSelect: (id: string) => void;
  onNew: () => void;
}

/** Session picker (switch, new) plus who the conversation is with, its model and profile, and where it runs. */
export function ClaudePanelHeader({ sessions, agents, selectedId, session, agent, profile, onSelect, onNew }: Props) {
  const pickerId = useId();
  const labelOf = (id: string): string => agents.find((a) => a.id === id)?.label ?? id;
  const identity = agent ? identityOf(agent.id, agent.label) : undefined;
  const chips = Object.entries(profile).filter(([, value]) => value !== undefined && value !== "");
  return (
    <header className="claude-head">
      <div className="claude-head__row">
        {identity ? <Logo identity={identity} size={24} /> : null}
        <div className="claude-head__picker">
          <select id={pickerId} aria-label="Session" value={selectedId ?? ""} onChange={(e) => e.target.value !== "" && onSelect(e.target.value)}>
            {selectedId === undefined ? <option value="">New session</option> : null}
            {sessions.map(({ session: s }) => (
              <option key={s.id} value={s.id}>
                {s.title} · {labelOf(s.agent)}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="claude-head__new" onClick={onNew}>
          New session
        </button>
      </div>
      {agent ? (
        <ul className="claude-head__chips" aria-label="Agent, model and profile">
          <li className="claude-head__chip claude-head__chip--agent">{agent.label}</li>
          {session ? (
            <li className="claude-head__chip" data-status={session.status}>
              {session.status}
            </li>
          ) : null}
          {chips.map(([field, value]) => (
            <li key={field} className="claude-head__chip" title={field}>
              {value}
            </li>
          ))}
          {session ? <li className="claude-head__chip claude-head__chip--cwd">{session.cwd}</li> : null}
        </ul>
      ) : null}
    </header>
  );
}

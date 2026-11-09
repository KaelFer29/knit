import { useId } from "react";
import { Logo } from "../atoms/Logo";
import { identityOf } from "../identity/agents";
import type { AgentView } from "../sessions/types";
import "./NewSessionHeader.css";

interface Props {
  agents: AgentView[];
  agentId: string;
  cwd: string;
  onAgentChange: (id: string) => void;
  onCwdChange: (cwd: string) => void;
}

/** Choosing who to talk to and where it runs, before the first prompt. One radio per agent the server offers. */
export function NewSessionHeader({ agents, agentId, cwd, onAgentChange, onCwdChange }: Props) {
  const cwdId = useId();
  return (
    <header className="new-session">
      <h2 className="new-session__title">New session</h2>
      <div className="new-session__agents" role="radiogroup" aria-label="Agent">
        {agents.map((agent) => (
          <label key={agent.id} className="new-session__agent">
            <input type="radio" name="new-session-agent" className="new-session__radio" value={agent.id} checked={agent.id === agentId} onChange={() => onAgentChange(agent.id)} />
            <span className="new-session__face">
              <Logo identity={identityOf(agent.id, agent.label)} size={24} />
              {agent.label}
            </span>
          </label>
        ))}
      </div>
      <label className="new-session__cwd" htmlFor={cwdId}>
        <span>Directory</span>
        <input id={cwdId} type="text" value={cwd} placeholder="/absolute/path/to/repository" spellCheck={false} autoComplete="off" onChange={(e) => onCwdChange(e.target.value)} />
      </label>
    </header>
  );
}

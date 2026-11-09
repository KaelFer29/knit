import type { AgentIdentity } from "../identity/agents";
import { Logo } from "../atoms/Logo";
import "./AgentBadge.css";

/** An agent's logo with its name and role. Presentational: everything comes from the identity. */
export function AgentBadge({ identity }: { identity: AgentIdentity }) {
  return (
    <div className="agent-badge">
      <Logo identity={identity} />
      <div className="agent-badge__text">
        <span className="agent-badge__label">{identity.label}</span>
        <span className="agent-badge__role">{identity.role}</span>
      </div>
    </div>
  );
}

import { ClaudeMascot } from "../../../atoms/ClaudeMascot";
import { Logo } from "../../../atoms/Logo";
import type { AgentIdentity } from "../../../identity/agents";
import "./EmptyConversation.css";

/** What a conversation with no messages shows: who is here and what to do first, not a form. */
export function EmptyConversation({ identity }: { identity: AgentIdentity }) {
  return (
    <div className="empty-chat">
      {identity.skin === "terminal" ? <ClaudeMascot className="empty-chat__mascot" /> : <Logo identity={identity} size={40} />}
      <h3 className="empty-chat__title">Plan with {identity.label}</h3>
      <p className="empty-chat__text">Describe what you want built. Turn on “Send to the orchestrator” and the agent drafts a plan you can send to Cursor.</p>
    </div>
  );
}

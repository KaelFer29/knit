import { AGENTS, AGENT_ORDER } from "../identity/agents";
import { AgentBadge } from "../molecules/AgentBadge";
import "./EmptyCanvas.css";

/** What the main area shows before there is a run to draw: the three identities and a hint. */
export function EmptyCanvas() {
  return (
    <section className="empty-canvas" aria-labelledby="empty-canvas-title">
      <ol className="empty-canvas__flow">
        {AGENT_ORDER.map((id) => (
          <li key={id} className="empty-canvas__step">
            <AgentBadge identity={AGENTS[id]} />
          </li>
        ))}
      </ol>
      <h1 id="empty-canvas-title" className="empty-canvas__title">
        Nothing to show yet
      </h1>
      <p className="empty-canvas__hint">A run will be drawn here as a circuit: the plan, Knit's queue and checks, and the builder at work.</p>
    </section>
  );
}

import { AGENTS, type AgentIdentity } from "../identity/agents";
import { Logo } from "../atoms/Logo";
import type { ConfigFileEntry } from "../config/api";
import "./ConfigFileList.css";

interface Props {
  files: ConfigFileEntry[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

const SCOPES = [
  { scope: "project", title: "Project" },
  { scope: "global", title: "Global" },
] as const;

/** Files grouped by agent, then by scope. Presentational: identities come from the identity module. */
export function ConfigFileList({ files, selectedId, onSelect }: Props) {
  const agents = [...new Set(files.map((f) => f.agent))];
  return (
    <nav className="config-list" aria-label="Configuration files">
      {agents.map((agent) => {
        const identity: AgentIdentity | undefined = AGENTS[agent];
        return (
          <section key={agent} className="config-list__agent" style={identity ? { ["--accent" as string]: identity.accent } : undefined}>
            <h2 className="config-list__agent-name">
              {identity ? <Logo identity={identity} size={20} /> : null}
              {identity?.label ?? agent}
            </h2>
            {SCOPES.map(({ scope, title }) => {
              const group = files.filter((f) => f.agent === agent && f.scope === scope);
              if (group.length === 0) return null;
              return (
                <div key={scope} className="config-list__scope">
                  <h3 className="config-list__scope-name">{title}</h3>
                  <ul className="config-list__files">
                    {group.map((file) => (
                      <li key={file.id}>
                        <button
                          type="button"
                          className="config-list__file"
                          aria-current={file.id === selectedId ? "true" : undefined}
                          title={file.displayPath}
                          onClick={() => onSelect(file.id)}
                        >
                          <span className="config-list__label">{file.label}</span>
                          {file.exists ? null : <span className="config-list__new">new</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        );
      })}
    </nav>
  );
}

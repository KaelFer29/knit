import type { AgentView } from "./types";

/** `knit` commands are handled by Knit itself; `agent` commands are sent to the agent as the prompt (D9). */
export interface PaletteCommand {
  name: string;
  description: string;
  source: "knit" | "agent";
}

/**
 * The command palette of a session: Knit's own session commands (each offered only when the agent's declared
 * capabilities make it meaningful) followed by the agent's own list. A Knit command hides an agent command of the same name.
 */
export function paletteCommands(agent: AgentView | undefined, agentCommands: string[]): PaletteCommand[] {
  const own: PaletteCommand[] = [{ name: "clear", description: "Start a new session", source: "knit" }];
  if (agent?.capabilities.chooseModel) own.push({ name: "model", description: "Pick the model for the next turn", source: "knit" });
  // Offered to every agent so `/usage` never vanishes silently: see `usageAction` for what it does.
  if (agent) own.push({ name: "usage", description: agent.capabilities.planUsage ? "Ask for plan usage" : "Plan usage (not reported by this agent)", source: "knit" });
  const taken = new Set(own.map((c) => c.name));
  const theirs: PaletteCommand[] = [];
  if (agent?.capabilities.commandList) {
    for (const name of agentCommands) {
      if (taken.has(name)) continue;
      taken.add(name);
      theirs.push({ name, description: `Send /${name} to ${agent.label}`, source: "agent" });
    }
  }
  return [...own, ...theirs];
}

/** The palette's commands that match what follows the slash: prefix matches first, then substring matches. */
export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const q = query.toLowerCase();
  if (q === "") return commands;
  return [...commands.filter((c) => c.name.toLowerCase().startsWith(q)), ...commands.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q))];
}

/** The text being typed as a palette query: only a lone `/word` opens the palette. */
export function paletteQuery(text: string): string | undefined {
  const match = /^\/([\w:.-]*)$/.exec(text);
  return match?.[1];
}

/** The Knit command a submitted text is, when it is exactly `/name`; everything else goes to the agent. */
export function knitCommandOf(text: string, commands: PaletteCommand[]): PaletteCommand | undefined {
  const match = /^\/([\w:.-]+)$/.exec(text.trim());
  return commands.find((c) => c.source === "knit" && c.name === match?.[1]);
}

/** What `/usage` does: an agent that reports plan usage answers it as a turn; for any other the interface says so. */
export function usageAction(agent: AgentView): { kind: "send"; prompt: string } | { kind: "notice"; text: string } {
  return agent.capabilities.planUsage ? { kind: "send", prompt: "/usage" } : { kind: "notice", text: `${agent.label} does not report plan usage.` };
}

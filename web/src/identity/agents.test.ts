import { describe, expect, it } from "vitest";
import { AGENTS, AGENT_ORDER, logoUrl } from "./agents";

describe("agent identities", () => {
  it("lists the three blocks left to right", () => {
    expect(AGENT_ORDER).toEqual(["claude", "knit", "cursor"]);
  });

  it("gives each agent a label, a role and a monogram", () => {
    expect(AGENTS.claude).toMatchObject({ label: "Claude", role: "planner", monogram: "C" });
    expect(AGENTS.knit).toMatchObject({ label: "Orchestrator", role: "orchestrator", monogram: "O" });
    expect(AGENTS.cursor).toMatchObject({ label: "Cursor", role: "builder", monogram: "C" });
  });

  it("gives each block its own look: a terminal for Claude, a pipeline for the orchestrator, an editor for Cursor", () => {
    expect(AGENT_ORDER.map((id) => AGENTS[id].skin)).toEqual(["terminal", "pipeline", "editor"]);
  });

  it("points the official logos at the git-ignored brand folder", () => {
    expect(logoUrl(AGENTS.claude)).toBe("/brand/claude.svg");
    expect(logoUrl(AGENTS.cursor)).toBe("/brand/cursor.svg");
  });

  it("draws Knit's own mark instead of loading a file", () => {
    expect(AGENTS.knit.logoFile).toBeUndefined();
    expect(logoUrl(AGENTS.knit)).toBeUndefined();
  });

  it("keeps brand colors as design tokens, never literal colors", () => {
    for (const id of AGENT_ORDER) {
      expect(AGENTS[id].accent).toBe(`var(--agent-${id})`);
      expect(AGENTS[id].accentSoft).toBe(`var(--agent-${id}-soft)`);
    }
  });
});

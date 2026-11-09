/**
 * Agent identities: the one place that knows what each block is called and how it looks.
 * Components receive an `AgentIdentity` and never branch on the agent's name.
 * Brand colors are design tokens (see styles/tokens.css), never literal colors.
 */

export type AgentId = "claude" | "knit" | "cursor";

export type AgentRole = "planner" | "orchestrator" | "builder";

/** How a block is drawn: Claude as a Claude Code terminal, the orchestrator as a pipeline, Cursor as an editor. */
export type BlockSkin = "terminal" | "pipeline" | "editor";

export interface AgentIdentity {
  id: AgentId;
  label: string;
  role: AgentRole;
  /** Short word shown under the label. */
  tagline: string;
  skin: BlockSkin;
  /** CSS value of the brand color, a design token. */
  accent: string;
  /** Tinted surface that goes with the accent, a design token. */
  accentSoft: string;
  /** File name of the official logo inside `/brand/` (git-ignored, filled by the user). Absent when the mark is drawn in code. */
  logoFile?: string;
  /** The official logo is a single-color mark drawn black; it is inverted where it sits on a dark surface. */
  monochrome?: boolean;
  /** One or two letters (or Claude's spark glyph) shown when the logo file is missing. */
  monogram: string;
  /** A mark drawn in code that stands in for the logo file while it is missing, instead of the monogram. */
  fallbackMark?: "pointer";
  /** Never draws a mark or loads a file: only the monogram (an agent the interface has no brand for). */
  monogramOnly?: boolean;
}

const tokens = (id: AgentId) => ({ accent: `var(--agent-${id})`, accentSoft: `var(--agent-${id}-soft)` });

export const AGENTS: Record<AgentId, AgentIdentity> = {
  claude: { id: "claude", label: "Claude", role: "planner", tagline: "planner", skin: "terminal", ...tokens("claude"), logoFile: "claude.svg", monogram: "✻" },
  // The orchestrator is part of Knit (the product), not a brand: its mark is drawn in code, so it needs no file.
  knit: { id: "knit", label: "Orchestrator", role: "orchestrator", tagline: "pipeline", skin: "pipeline", ...tokens("knit"), monogram: "O" },
  cursor: { id: "cursor", label: "Cursor", role: "builder", tagline: "builder", skin: "editor", ...tokens("cursor"), logoFile: "cursor.svg", monochrome: true, monogram: "C", fallbackMark: "pointer" },
};

/** The blocks of the canvas, left to right. */
export const AGENT_ORDER: readonly AgentId[] = ["claude", "knit", "cursor"];

export const BRAND_DIR = "/brand";

/** URL of the official logo file, or `undefined` when the identity draws its own mark. */
export function logoUrl(identity: AgentIdentity): string | undefined {
  return identity.logoFile === undefined ? undefined : `${BRAND_DIR}/${identity.logoFile}`;
}

/**
 * The identity for an agent id taken from the API. An agent the interface has no brand for gets a neutral monogram
 * identity, so a new adapter shows up without a code change here.
 */
export function identityOf(id: string, label?: string): AgentIdentity {
  const known = (AGENTS as Partial<Record<string, AgentIdentity>>)[id];
  if (known !== undefined) return known;
  const name = label ?? id;
  return {
    id: "knit",
    label: name,
    role: "builder",
    tagline: "builder",
    skin: "editor",
    accent: "var(--text-muted)",
    accentSoft: "var(--surface-2)",
    monogram: name.slice(0, 1).toUpperCase() || "?",
    monogramOnly: true,
  };
}

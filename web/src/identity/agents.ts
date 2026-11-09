/**
 * Agent identities: the one place that knows what each block is called and how it looks.
 * Components receive an `AgentIdentity` and never branch on the agent's name.
 * Brand colors are design tokens (see styles/tokens.css), never literal colors.
 */

export type AgentId = "claude" | "knit" | "cursor";

export type AgentRole = "planner" | "orchestrator" | "builder";

export interface AgentIdentity {
  id: AgentId;
  label: string;
  role: AgentRole;
  /** CSS value of the brand color, a design token. */
  accent: string;
  /** Tinted surface that goes with the accent, a design token. */
  accentSoft: string;
  /** File name of the official logo inside `/brand/` (git-ignored, filled by the user). Absent when the mark is drawn in code. */
  logoFile?: string;
  /** The official logo is a single-color mark that must flip with the theme (drawn black, shown white on dark). */
  monochrome?: boolean;
  /** One or two letters shown when the logo file is missing. */
  monogram: string;
}

const tokens = (id: AgentId) => ({ accent: `var(--agent-${id})`, accentSoft: `var(--agent-${id}-soft)` });

export const AGENTS: Record<AgentId, AgentIdentity> = {
  claude: { id: "claude", label: "Claude", role: "planner", ...tokens("claude"), logoFile: "claude.svg", monogram: "C" },
  // Knit's own mark is original and lives in code (atoms/KnitMark), so it needs no file.
  knit: { id: "knit", label: "Knit", role: "orchestrator", ...tokens("knit"), monogram: "K" },
  cursor: { id: "cursor", label: "Cursor", role: "builder", ...tokens("cursor"), logoFile: "cursor.svg", monochrome: true, monogram: "C" },
};

/** The blocks of the canvas, left to right. */
export const AGENT_ORDER: readonly AgentId[] = ["claude", "knit", "cursor"];

export const BRAND_DIR = "/brand";

/** URL of the official logo file, or `undefined` when the identity draws its own mark. */
export function logoUrl(identity: AgentIdentity): string | undefined {
  return identity.logoFile === undefined ? undefined : `${BRAND_DIR}/${identity.logoFile}`;
}

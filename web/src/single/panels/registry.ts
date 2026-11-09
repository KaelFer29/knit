/**
 * The side-panel contract of the single view.
 *
 * Clicking a block (or the configuration button) opens one panel next to the pipeline. Which component fills it is
 * decided here, and only here: `PANELS` maps each `PanelId` to a title and a component that takes `PanelProps`.
 * The shell (`containers/SingleView`) owns opening, closing, focus and the frame; a panel only renders its body.
 *
 * Each panel lives in its own folder, `panels/<name>/`, and exports one component named `<Name>Panel` from
 * `panels/<name>/<Name>Panel.tsx`. Replacing a panel body means editing that folder; this file and `PanelProps`
 * stay stable. A panel fetches its own data (containers fetch, presentational parts render) and must render
 * agent output as text.
 */
import type { ComponentType } from "react";
import type { BoardModel } from "@board";
import type { RenderDetail } from "../../flow/detail";
import type { AgentId } from "../../identity/agents";
import { ClaudePanel } from "./claude/ClaudePanel";
import { ConfigPanel } from "./config/ConfigPanel";
import { CursorPanel } from "./cursor/CursorPanel";
import { KnitPanel } from "./knit/KnitPanel";

/** The three blocks plus the configuration preview opened from the header. */
export type PanelId = AgentId | "config";

/** What the shell hands every panel. Optional fields are absent when there is no run (idle) or no live API (fixtures). */
export interface PanelProps {
  /** Board of the run the view shows (the picked or most recent run). */
  board: BoardModel | undefined;
  /** Id of that run when it comes from the API; absent for a fixture. */
  runId: string | undefined;
  /** True when `board` is live from the API, false for fixtures and demo data. */
  live: boolean;
  /** Opens the detail of a task or agent of the run (attempts, timeline, diff); absent while the snapshot loads. */
  renderDetail: RenderDetail | undefined;
  /** Makes another run the one the view shows (`undefined` goes back to the most recent run). */
  selectRun: (runId: string | undefined) => void;
}

export interface PanelDefinition {
  /** Heading of the panel, also its accessible name. */
  title: string;
  Component: ComponentType<PanelProps>;
}

export const PANELS: Record<PanelId, PanelDefinition> = {
  claude: { title: "Claude", Component: ClaudePanel },
  knit: { title: "Orchestrator", Component: KnitPanel },
  cursor: { title: "Cursor", Component: CursorPanel },
  config: { title: "Configuration", Component: ConfigPanel },
};

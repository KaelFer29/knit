import type { TokenTotals } from "@board";
import type { AgentId } from "../identity/agents";
import type { RunListItem } from "./types";

/**
 * Token totals of a run per block, as the board does it: attempts are the builder's, Knit never calls a model and
 * Claude's turns are sessions, not attempts, so only the builder has a count in the list.
 */
export function tokensByAgent(item: Pick<RunListItem, "inputTokens" | "outputTokens">): Record<AgentId, TokenTotals> {
  return { claude: { input: 0, output: 0 }, knit: { input: 0, output: 0 }, cursor: { input: item.inputTokens, output: item.outputTokens } };
}

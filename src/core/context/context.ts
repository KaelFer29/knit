/** What an agent reports about the tokens of one turn. Fields it does not report are absent. */
export interface TurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** The window assumed for a model whose id does not say its own. */
export const DEFAULT_WINDOW = 200_000;

const count = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * How much context a chat carries after a turn: what it sent fresh plus what it read from and wrote to the cache (a
 * resumed chat sends little fresh and reads the rest from the cache, so the input alone would hide almost all of it).
 * The agent's own output is not counted: it becomes input of the next turn. Unknown when no input was reported.
 */
export function contextTokensOf(usage: TurnUsage | undefined): number | undefined {
  if (usage === undefined || !(typeof usage.inputTokens === "number" && usage.inputTokens >= 0)) return undefined;
  return count(usage.inputTokens) + count(usage.cacheReadTokens) + count(usage.cacheWriteTokens);
}

/** The window a model id carries (`name[context=1m]`, `[context=200k]`, `[context=128000]`), when it says one. */
function statedWindow(model: string | undefined): number | undefined {
  const match = /\[[^\]]*\bcontext=(\d+(?:\.\d+)?)([km])?\b[^\]]*\]/i.exec(model ?? "");
  if (match === null) return undefined;
  const unit = match[2]?.toLowerCase();
  const window = Math.round(Number(match[1]) * (unit === "m" ? 1_000_000 : unit === "k" ? 1_000 : 1));
  return window > 0 ? window : undefined;
}

/** The window of a model: the one its id carries, else the default. */
export const contextWindowOf = (model: string | undefined): number => statedWindow(model) ?? DEFAULT_WINDOW;

/** Whether the window comes from the model id (true) or is the assumed default (false). */
export const windowIsStated = (model: string | undefined): boolean => statedWindow(model) !== undefined;

/** The fraction of the window in use, from 0 to 1. */
export function contextShare(tokens: number, window: number): number {
  return window <= 0 ? 0 : Math.min(1, Math.max(0, tokens / window));
}

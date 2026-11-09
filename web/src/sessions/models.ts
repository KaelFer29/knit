/**
 * Names and one-line descriptions for the models the picker offers, as Claude Code's own model picker words them.
 * An id the table does not know is shown as it is, with no description: nothing is invented for it.
 */
export interface ModelInfo {
  name: string;
  hint?: string;
}

const FAMILIES: Record<string, ModelInfo> = {
  opus: { name: "Opus 5.5", hint: "For complex work and everyday tasks" },
  sonnet: { name: "Sonnet 5.5", hint: "Most efficient for simpler tasks" },
  fable: { name: "Fable 5.1", hint: "For your toughest challenges" },
  haiku: { name: "Haiku 5.5", hint: "Fastest for quick answers" },
};

/** `claude-sonnet-5-5` and `sonnet` are the same family; anything else is its own. */
function familyOf(id: string): string | undefined {
  const match = /^(?:claude-)?(opus|sonnet|fable|haiku)(?:-[\d-]+)?$/.exec(id);
  return match?.[1];
}

export function modelInfo(id: string): ModelInfo {
  const family = familyOf(id);
  return family === undefined ? { name: id } : FAMILIES[family]!;
}

export interface ModelChoice extends ModelInfo {
  id: string;
}

/** The picker's rows: each named model once (the first id that names it wins), unknown ids as they are. */
export function modelChoices(ids: string[]): ModelChoice[] {
  const seen = new Set<string>();
  const out: ModelChoice[] = [];
  for (const id of ids) {
    const info = modelInfo(id);
    if (seen.has(info.name)) continue;
    seen.add(info.name);
    out.push({ id, ...info });
  }
  return out;
}

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

/**
 * An id as the interface shows it: the parameters of `name[context=1m,effort=high,fast=false]` go after dashes
 * (`name-1m-high`), never in long brackets. A flag that is on is shown by its name, one that is off is left out.
 */
export function shortModelId(id: string): string {
  const match = /^([^[\]]*)\[([^[\]]*)\]$/.exec(id);
  if (match === null) return id.replace(/[[\]]/g, "");
  const params = match[2]!
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .flatMap((p) => {
      const [key = "", ...rest] = p.split("=");
      const value = rest.join("=");
      if (value === "" || value === "true") return [key];
      return value === "false" ? [] : [value];
    });
  return [match[1]!, ...params].filter((part) => part !== "").join("-");
}

export function modelInfo(id: string): ModelInfo {
  const family = familyOf(id);
  return family === undefined ? { name: shortModelId(id) } : FAMILIES[family]!;
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

import type { PrDraft } from "./types";

export interface SavedDraft {
  title: string;
  body: string;
  model: string;
}

const PREFIX = "knit.pr-draft:";
const memory = new Map<string, SavedDraft>();
const inFlight = new Map<string, Promise<PrDraft>>();

/**
 * The key of a draft: the run, the task and the commit the branch is at. A new commit changes the key, so a text
 * written for an older state of the branch is never offered for the new one.
 */
export const draftKey = (runId: string, taskId: string, head: string | undefined): string => `${runId}:${taskId}:${head ?? ""}`;

/** The text already written for this state of the branch, kept in memory and in this tab's session storage. */
export function loadDraft(key: string): SavedDraft | undefined {
  const known = memory.get(key);
  if (known) return known;
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "title" in parsed && "body" in parsed && "model" in parsed) {
      const { title, body, model } = parsed as Record<string, unknown>;
      if (typeof title === "string" && typeof body === "string" && typeof model === "string") {
        memory.set(key, { title, body, model });
        return { title, body, model };
      }
    }
  } catch {
    // Storage can be blocked or hold something else: no saved text.
  }
  return undefined;
}

export function saveDraft(key: string, draft: SavedDraft): void {
  memory.set(key, draft);
  try {
    window.sessionStorage.setItem(PREFIX + key, JSON.stringify(draft));
  } catch {
    // Without storage the text still lasts while the page is open.
  }
}

export function forgetDraft(key: string): void {
  memory.delete(key);
  try {
    window.sessionStorage.removeItem(PREFIX + key);
  } catch {
    // Nothing to forget.
  }
}

/**
 * Asks the model once per key: a second request while the first is still running shares its answer, so closing the form
 * and opening it again while the text is being written does not pay for a second one. A good answer is saved.
 */
export function draftOnce(key: string, ask: () => Promise<PrDraft>, how = ""): Promise<PrDraft> {
  const flight = `${key}|${how}`;
  const running = inFlight.get(flight);
  if (running) return running;
  const call = ask()
    .then((d) => {
      saveDraft(key, { title: d.title, body: d.body, model: d.model });
      return d;
    })
    .finally(() => inFlight.delete(flight));
  inFlight.set(flight, call);
  return call;
}

/** For tests: forget everything held in memory. */
export function resetDraftCache(): void {
  memory.clear();
  inFlight.clear();
}

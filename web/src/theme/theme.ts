export type ThemeChoice = "light" | "dark" | "system";

export const THEME_KEY = "knit.theme";

export const THEME_CHOICES: readonly ThemeChoice[] = ["light", "dark", "system"];

const isChoice = (value: unknown): value is ThemeChoice => THEME_CHOICES.includes(value as ThemeChoice);

/** Storage can be missing, blocked or throw (private windows, cleared site data): every access is guarded. */
function defaultStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readStoredTheme(storage: Storage | undefined = defaultStorage()): ThemeChoice {
  try {
    const value = storage?.getItem(THEME_KEY);
    return isChoice(value) ? value : "system";
  } catch {
    return "system";
  }
}

export function storeTheme(choice: ThemeChoice, storage: Storage | undefined = defaultStorage()): void {
  try {
    storage?.setItem(THEME_KEY, choice);
  } catch {
    // The choice still applies to this page; it just will not be remembered.
  }
}

/** An explicit choice sets `data-theme`; `system` removes it so `prefers-color-scheme` decides. */
export function applyTheme(choice: ThemeChoice, root: HTMLElement = document.documentElement): void {
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

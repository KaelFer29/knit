import { useCallback, useEffect, useState } from "react";
import { applyTheme, readStoredTheme, storeTheme, type ThemeChoice } from "./theme";

/** The theme choice, applied to the document and remembered. Reads the stored choice once, on first render. */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(() => readStoredTheme());

  useEffect(() => applyTheme(choice), [choice]);

  const update = useCallback((next: ThemeChoice) => {
    storeTheme(next);
    setChoice(next);
  }, []);

  return [choice, update];
}

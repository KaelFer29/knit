import { beforeEach, describe, expect, it } from "vitest";
import { THEME_KEY, applyTheme, readStoredTheme, storeTheme } from "./theme";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("theme storage", () => {
  it("defaults to the system theme", () => {
    expect(readStoredTheme()).toBe("system");
  });

  it("round-trips a stored choice", () => {
    storeTheme("dark");
    expect(window.localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(readStoredTheme()).toBe("dark");
  });

  it("ignores a value it does not know", () => {
    window.localStorage.setItem(THEME_KEY, "sepia");
    expect(readStoredTheme()).toBe("system");
  });

  it("survives a storage that throws", () => {
    const broken = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(readStoredTheme(broken)).toBe("system");
    expect(() => storeTheme("light", broken)).not.toThrow();
  });
});

describe("applyTheme", () => {
  it("sets data-theme for an explicit choice", () => {
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("removes data-theme for the system choice so the media query decides", () => {
    applyTheme("dark");
    applyTheme("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  document.documentElement.removeAttribute("data-theme");
});

describe("app shell", () => {
  it("renders the header with the Knit name and the single view in the main area", () => {
    render(<App />);
    expect(screen.getByRole("banner").textContent).toContain("Knit");
    const main = screen.getByRole("main");
    expect(main).toBeTruthy();
    expect(main.id).toBe("canvas");
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("introduces the three identities on a fixture canvas", () => {
    window.history.replaceState(null, "", "/?fixture=runningRun");
    render(<App />);
    const main = screen.getByRole("main");
    for (const text of ["Claude", "planner", "Orchestrator", "pipeline", "Cursor", "Agent"]) {
      expect(main.textContent).toContain(text);
    }
  });

  it("offers a skip link to the main area", () => {
    render(<App />);
    expect(screen.getByRole("link", { name: /skip to content/i }).getAttribute("href")).toBe("#canvas");
  });
});

describe("light theme only", () => {
  it("has no theme choice and never sets a theme on the page", () => {
    window.localStorage.setItem("knit.theme", "dark");
    render(<App />);
    expect(screen.queryByRole("radiogroup", { name: /theme/i })).toBeNull();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});

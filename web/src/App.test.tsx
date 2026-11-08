import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  document.documentElement.removeAttribute("data-theme");
});

describe("app shell", () => {
  it("renders the header with the Knit name and an empty main area", () => {
    render(<App />);
    expect(screen.getByRole("banner").textContent).toContain("Knit");
    const main = screen.getByRole("main");
    expect(main).toBeTruthy();
    expect(main.id).toBe("canvas");
  });

  it("introduces the three identities on a fixture canvas", () => {
    window.history.replaceState(null, "", "/?fixture=runningRun");
    render(<App />);
    const main = screen.getByRole("main");
    for (const text of ["Claude", "planner", "Knit", "orchestrator", "Cursor", "builder"]) {
      expect(main.textContent).toContain(text);
    }
  });

  it("offers a skip link to the main area", () => {
    render(<App />);
    expect(screen.getByRole("link", { name: /skip to content/i }).getAttribute("href")).toBe("#canvas");
  });
});

describe("theme toggle", () => {
  it("offers light, dark and system, with system selected by default", () => {
    render(<App />);
    const group = screen.getByRole("radiogroup", { name: /theme/i });
    expect(group).toBeTruthy();
    expect((screen.getByRole("radio", { name: /system/i }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("radio", { name: /light/i })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /dark/i })).toBeTruthy();
  });

  it("applies data-theme and persists the choice", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("radio", { name: /dark/i }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem("knit.theme")).toBe("dark");
    await user.click(screen.getByRole("radio", { name: /light/i }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem("knit.theme")).toBe("light");
    await user.click(screen.getByRole("radio", { name: /system/i }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(window.localStorage.getItem("knit.theme")).toBe("system");
  });

  it("restores the stored choice on load", () => {
    window.localStorage.setItem("knit.theme", "dark");
    render(<App />);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect((screen.getByRole("radio", { name: /dark/i }) as HTMLInputElement).checked).toBe(true);
  });

  it("moves between choices with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.tab(); // skip link
    await user.tab(); // Runs
    await user.tab(); // Workspace
    await user.tab(); // Configuration
    await user.tab(); // the checked radio of the group
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: /system/i }));
    await user.keyboard("{ArrowLeft}");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

describe("navigation", () => {
  it("shows the runs list by default and marks Runs as the current page", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ runs: [] }), { status: 200 })));
    window.location.hash = "";
    render(<App />);
    expect(screen.getByRole("link", { name: "Runs" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("main").getAttribute("aria-label")).toBe("Runs");
    vi.unstubAllGlobals();
  });

  it("opens the workspace from its route and follows the link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ agents: [], sessions: [] }), { status: 200 })));
    const user = userEvent.setup();
    window.location.hash = "";
    render(<App />);
    await user.click(screen.getByRole("link", { name: "Workspace" }));
    expect(await screen.findByRole("region", { name: "Sessions" })).toBeTruthy();
    expect(screen.getByRole("main").getAttribute("aria-label")).toBe("Workspace");
    expect(screen.getByRole("link", { name: "Workspace" }).getAttribute("aria-current")).toBe("page");
    vi.unstubAllGlobals();
    window.location.hash = "";
  });
});

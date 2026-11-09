import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configApi from "../config/api";
import { ALL_FIXTURES } from "../fixtures/boards";
import { SingleView } from "./SingleView";

vi.mock("../config/api");

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, statusText: "x", json: async () => body });

beforeEach(() => {
  window.location.hash = "";
  vi.mocked(configApi.listConfigFiles).mockResolvedValue([]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ runs: [], sessions: [], agents: [], cwd: "/home/kael/orquestador" })));
});
afterEach(() => vi.unstubAllGlobals());

describe("SingleView", () => {
  it("opens on three blocks and the pipeline, with no page navigation", () => {
    render(<SingleView search="?fixture=runningRun" />);
    for (const name of ["Claude", "Orchestrator", "Cursor"]) expect(screen.getByRole("button", { name: `Open ${name}` })).toBeTruthy();
    expect(screen.getAllByRole("region", { name: /Claude to orchestrator|Orchestrator to Cursor|Cursor back to orchestrator/ })).toHaveLength(3);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("link", { name: /Runs|Workspace/ })).toBeNull();
  });

  it("shows each block's live state without opening it", () => {
    render(<SingleView search="?fixture=runningRun" />);
    const cursor = screen.getByRole("group", { name: "Cursor" });
    expect(within(cursor).getByText("T3")).toBeTruthy();
    expect(within(cursor).getByTitle("edit: src/billing/webhook-store.ts").textContent).toContain("webhook-store.ts");
    expect(within(screen.getByRole("group", { name: "Orchestrator" })).getByText("2 of 6 tasks delivered")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Orchestrator to Cursor" })).getByText("Agent working", { selector: ".hop__current" })).toBeTruthy();
  });

  it("expands a block's details below it without opening the panel, and folds them again", async () => {
    const user = userEvent.setup();
    render(<SingleView search="?fixture=runningRun" />);
    const toggle = screen.getByRole("button", { name: "Cursor details" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const region = screen.getByRole("region", { name: "Cursor details" });
    expect(within(region).getByText("Attempt")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(toggle);
    expect(screen.queryByRole("region", { name: "Cursor details" })).toBeNull();
  });

  it("shows the working directory once, in the header, for every agent", async () => {
    render(<SingleView search="" />);
    const header = screen.getByRole("banner");
    expect(await within(header).findByText("/home/kael/orquestador")).toBeTruthy();
    expect(within(header).getByTitle("Where Knit was launched; agents work here")).toBeTruthy();
  });

  it("shows no directory for sample data, which has none", () => {
    render(<SingleView search="?fixture=runningRun" />);
    expect(within(screen.getByRole("banner")).queryByTitle("Where Knit was launched; agents work here")).toBeNull();
  });

  it("is idle with no run and no session", async () => {
    render(<SingleView search="" />);
    expect(await screen.findByText("No run yet")).toBeTruthy();
    expect(screen.getByText("No session yet")).toBeTruthy();
    expect(screen.getByText("Waiting for a plan", { selector: ".hop__current" })).toBeTruthy();
  });

  it("follows the most recent run when none is picked", async () => {
    // The server answers newest first, and the page asks for just one run: the newest.
    const newest = { run: { id: "new", planName: "new", planPath: "p", startedAt: "2026-02-01T00:00:00Z", status: "passed" }, taskCounts: { total: 1, pending: 0, running: 0, passed: 1, failed: 0 }, inputTokens: 0, outputTokens: 0 };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/runs?")) return reply({ runs: [newest], total: 2 });
      if (url.startsWith("/api/runs/new")) return reply({ board: { ...ALL_FIXTURES.deliveredRun, planName: "newest-plan" }, lastEventId: 1, lastAgentEventId: 1 });
      return reply({ sessions: [], agents: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", class { addEventListener() {} close() {} });
    render(<SingleView search="" />);
    expect((await screen.findAllByText("newest-plan")).length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/runs?") && String(url).includes("limit=1"))).toBe(true);
  });

  it("opens a modal from a block over the pipeline, closes on Escape and returns the focus", async () => {
    const user = userEvent.setup();
    render(<SingleView search="?fixture=runningRun" />);
    const block = screen.getByRole("button", { name: "Open Cursor" });
    await user.click(block);
    const dialog = screen.getByRole("dialog", { name: "Cursor" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(block.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: "Orchestrator to Cursor" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(block);
  });

  it("is a real modal: it says so, closes on a click outside it and not on a click inside it", async () => {
    const user = userEvent.setup();
    render(<SingleView search="?fixture=runningRun" />);
    await user.click(screen.getByRole("button", { name: "Open Claude" }));
    const dialog = screen.getByRole("dialog", { name: "Claude" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    await user.click(within(dialog).getByRole("heading", { name: "Claude" }));
    expect(screen.getByRole("dialog", { name: "Claude" })).toBeTruthy();
    await user.click(screen.getByTestId("modal-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the Tab key inside the modal", async () => {
    const user = userEvent.setup();
    render(<SingleView search="?fixture=runningRun" />);
    await user.click(screen.getByRole("button", { name: "Open Cursor" }));
    const dialog = screen.getByRole("dialog", { name: "Cursor" });
    for (let i = 0; i < 40; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 40; i++) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  }, 20_000);

  it("wears the identity of the block that opened it", async () => {
    const user = userEvent.setup();
    render(<SingleView search="?fixture=runningRun" />);
    await user.click(screen.getByRole("button", { name: "Open Orchestrator" }));
    expect(screen.getByRole("dialog", { name: "Orchestrator" }).getAttribute("data-agent")).toBe("knit");
  });

  it("opens the panel with Enter and closes it with its button", async () => {
    const user = userEvent.setup();
    render(<SingleView search="?fixture=runningRun" />);
    screen.getByRole("button", { name: "Open Orchestrator" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Orchestrator" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close Orchestrator" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open Orchestrator" }));
  });

  it("opens the configuration preview from the header button, over the same view", async () => {
    const user = userEvent.setup();
    render(<SingleView search="?fixture=runningRun" />);
    const button = screen.getByRole("button", { name: "Configuration" });
    await user.click(button);
    const dialog = screen.getByRole("dialog", { name: "Configuration" });
    expect(await within(dialog).findByText(/pick a file to edit/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Claude" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(button);
  });
});

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
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ runs: [], sessions: [], agents: [] })));
});
afterEach(() => vi.unstubAllGlobals());

describe("SingleView", () => {
  it("opens on three blocks and the pipeline, with no page navigation", () => {
    render(<SingleView search="?fixture=runningRun" />);
    for (const name of ["Claude", "Knit", "Cursor"]) expect(screen.getByRole("button", { name: new RegExp(name) })).toBeTruthy();
    expect(screen.getAllByRole("region", { name: /Claude to Knit|Knit to Cursor|Cursor back to Knit/ })).toHaveLength(3);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("link", { name: /Runs|Workspace/ })).toBeNull();
  });

  it("shows each block's live state without opening it", () => {
    render(<SingleView search="?fixture=runningRun" />);
    const cursor = screen.getByRole("button", { name: /Cursor/ });
    expect(within(cursor).getByText("T3")).toBeTruthy();
    expect(within(cursor).getByText("edit: src/billing/webhook-store.ts")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /Knit/ })).getByText("2 of 6 tasks delivered")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Knit to Cursor" })).getByText("Agent working", { selector: ".hop__current" })).toBeTruthy();
  });

  it("is idle with no run and no session", async () => {
    render(<SingleView search="" />);
    expect(await screen.findByText("No run yet")).toBeTruthy();
    expect(screen.getByText("No session yet")).toBeTruthy();
    expect(screen.getByText("Waiting for a plan", { selector: ".hop__current" })).toBeTruthy();
  });

  it("follows the most recent run when none is picked", async () => {
    const list = { runs: [
      { run: { id: "old", planName: "old", planPath: "p", startedAt: "2026-01-01T00:00:00Z", status: "passed" }, taskCounts: { total: 1, pending: 0, running: 0, passed: 1, failed: 0 }, inputTokens: 0, outputTokens: 0 },
      { run: { id: "new", planName: "new", planPath: "p", startedAt: "2026-02-01T00:00:00Z", status: "passed" }, taskCounts: { total: 1, pending: 0, running: 0, passed: 1, failed: 0 }, inputTokens: 0, outputTokens: 0 },
    ] };
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/runs") return reply(list);
      if (url.startsWith("/api/runs/new")) return reply({ board: { ...ALL_FIXTURES.deliveredRun, planName: "newest-plan" }, lastEventId: 1, lastAgentEventId: 1 });
      return reply({ sessions: [], agents: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", class { addEventListener() {} close() {} });
    render(<SingleView search="" />);
    expect((await screen.findAllByText("newest-plan")).length).toBeGreaterThan(0);
  });

  it("opens a side panel from a block, keeps the pipeline, closes on Escape and returns the focus", async () => {
    const user = userEvent.setup();
    render(<SingleView search="?fixture=runningRun" />);
    const block = screen.getByRole("button", { name: /Cursor/ });
    await user.click(block);
    const dialog = screen.getByRole("dialog", { name: "Cursor" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(block.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: "Knit to Cursor" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(block);
  });

  it("opens the panel with Enter and closes it with its button", async () => {
    const user = userEvent.setup();
    render(<SingleView search="?fixture=runningRun" />);
    screen.getByRole("button", { name: /Knit/ }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Knit" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close Knit" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Knit/ }));
  });

  it("opens the configuration preview from the header button, over the same view", async () => {
    const user = userEvent.setup();
    render(<SingleView search="?fixture=runningRun" />);
    const button = screen.getByRole("button", { name: "Configuration" });
    await user.click(button);
    const dialog = screen.getByRole("dialog", { name: "Configuration" });
    expect(await within(dialog).findByText(/pick a file to edit/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Claude/ })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(button);
  });
});

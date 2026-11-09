import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunListItem } from "../runs/types";
import { RunsView } from "./RunsView";

const item = (id: string, status: RunListItem["run"]["status"], input = 0, output = 0): RunListItem => ({
  run: { id, planName: `plan-${id}`, planPath: "/p.md", startedAt: "2026-01-01T00:00:00Z", status },
  taskCounts: { total: 3, pending: 0, running: 0, passed: 2, failed: status === "failed" ? 1 : 0 },
  inputTokens: input,
  outputTokens: output,
});

const reply = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: "x", json: async () => body });

const onSelect = vi.fn();
beforeEach(() => onSelect.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe("RunsView", () => {
  it("lists runs with status, progress and tokens per agent, each a button that picks it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { runs: [item("r1", "failed", 1500, 500), item("r2", "passed")] })));
    render(<RunsView pollMs={60_000} onSelect={onSelect} selectedId="r2" />);
    const links = await screen.findAllByRole("button", { name: /plan-/ });
    expect(links.map((l) => l.getAttribute("aria-current"))).toEqual([null, "true"]);
    await userEvent.setup().click(links[0]!);
    expect(onSelect).toHaveBeenCalledWith("r1");
    expect(links[0]!.textContent).toContain("2 of 3 tasks · 1 failed");
    expect(links[0]!.textContent).toContain("Cursor2k");
    expect(links[0]!.textContent).toContain("Claude—");
    expect(links[0]!.textContent).toContain("Failed");
  });

  it("moves focus between runs with the arrow keys", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { runs: [item("r1", "passed"), item("r2", "passed")] })));
    const user = userEvent.setup();
    render(<RunsView pollMs={60_000} onSelect={onSelect} selectedId="r2" />);
    const links = await screen.findAllByRole("button", { name: /plan-/ });
    links[0]!.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(links[1]);
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(links[0]);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(links[1]);
  });

  it("goes back to the latest run", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { runs: [item("r1", "passed")] })));
    render(<RunsView pollMs={60_000} onSelect={onSelect} selectedId="r1" />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Latest" }));
    expect(onSelect).toHaveBeenCalledWith(undefined);
  });

  it("explains an empty list, and says plans come from Claude", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { runs: [] })));
    render(<RunsView pollMs={60_000} onSelect={onSelect} selectedId="r2" />);
    expect(await screen.findByText("No runs yet")).toBeTruthy();
    expect(screen.getByText(/Plans come from Claude/)).toBeTruthy();
  });

  it("shows a load error and loads again on request", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(500, { error: "boom" })).mockResolvedValue(reply(200, { runs: [item("r1", "passed")] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<RunsView pollMs={60_000} onSelect={onSelect} selectedId="r2" />);
    expect((await screen.findByRole("alert")).textContent).toContain("boom");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /plan-r1/ })).toBeTruthy();
  });

  it("does not start runs itself: no form, no start button, only the picker", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { runs: [item("run-1", "passed")] })));
    render(<RunsView onSelect={onSelect} />);
    await screen.findByRole("button", { name: /run-1/ });
    expect(screen.queryByText("Start a run")).toBeNull();
    expect(screen.queryByRole("button", { name: /start run/i })).toBeNull();
    expect(screen.queryByLabelText(/plan file/i)).toBeNull();
  });
});

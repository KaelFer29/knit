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

/** A server that pages, searches and filters like the real one, and remembers what it was asked. */
function serve(all: RunListItem[]) {
  const asked: URL[] = [];
  const fetchMock = vi.fn(async (input: string) => {
    const url = new URL(String(input), "http://knit.test");
    asked.push(url);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const words = (url.searchParams.get("q") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const status = url.searchParams.get("status");
    const rows = all.filter((r) => (status === null || r.run.status === status) && words.every((w) => `${r.run.planName} ${r.run.id}`.toLowerCase().includes(w)));
    return reply(200, { runs: rows.slice(offset, offset + limit), total: rows.length });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { asked, fetchMock };
}

const onSelect = vi.fn();
beforeEach(() => onSelect.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe("RunsView", () => {
  it("lists runs as compact rows with status, progress and tokens, each a button that picks it", async () => {
    serve([item("r1", "failed", 1500, 500), item("r2", "passed")]);
    render(<RunsView pollMs={60_000} onSelect={onSelect} selectedId="r2" />);
    const links = await screen.findAllByRole("button", { name: /plan-/ });
    expect(links.map((l) => l.getAttribute("aria-current"))).toEqual([null, "true"]);
    await userEvent.setup().click(links[0]!);
    expect(onSelect).toHaveBeenCalledWith("r1");
    expect(links[0]!.textContent).toContain("2/3");
    expect(links[0]!.textContent).toContain("2k tokens");
    expect(links[0]!.textContent).toContain("Failed");
    expect(links[1]!.textContent).not.toContain("tokens");
  });

  it("asks the server for one page at a time, and moves through the rest", async () => {
    const { asked } = serve(Array.from({ length: 11 }, (_, i) => item(`r${i + 1}`, "passed")));
    const user = userEvent.setup();
    render(<RunsView pollMs={60_000} onSelect={onSelect} />);
    expect(await screen.findAllByRole("button", { name: /plan-/ })).toHaveLength(8);
    expect(screen.getByText("1–8 of 11 runs")).toBeTruthy();
    expect(asked[0]!.searchParams.get("limit")).toBe("8");
    expect(asked[0]!.searchParams.get("offset")).toBe("0");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /plan-/ })).toHaveLength(3));
    expect(screen.getByText("9–11 of 11 runs")).toBeTruthy();
    expect(asked.at(-1)!.searchParams.get("offset")).toBe("8");
  });

  it("sends the search to the server and goes back to the first page", async () => {
    const { asked } = serve(Array.from({ length: 11 }, (_, i) => item(`r${i + 1}`, "passed")));
    const user = userEvent.setup();
    render(<RunsView pollMs={60_000} onSelect={onSelect} />);
    await screen.findAllByRole("button", { name: /plan-/ });
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await user.type(screen.getByRole("searchbox", { name: "Search runs" }), "r10");
    await waitFor(() => expect(screen.getAllByRole("button", { name: /plan-/ }).map((b) => b.textContent)).toEqual([expect.stringContaining("plan-r10")]));
    expect(screen.getByText("1 match")).toBeTruthy();
    const last = asked.at(-1)!;
    expect(last.searchParams.get("q")).toBe("r10");
    expect(last.searchParams.get("offset")).toBe("0");
  });

  it("does not ask the server once per keystroke", async () => {
    const { fetchMock } = serve([item("r1", "passed")]);
    const user = userEvent.setup();
    render(<RunsView pollMs={60_000} onSelect={onSelect} />);
    await screen.findAllByRole("button", { name: /plan-/ });
    const before = fetchMock.mock.calls.length;
    await user.type(screen.getByRole("searchbox", { name: "Search runs" }), "plan-r1");
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
    expect(fetchMock.mock.calls.length - before).toBeLessThanOrEqual(2);
  });

  it("filters by status on the server and says when nothing matches", async () => {
    const { asked } = serve([item("r1", "failed"), item("r2", "passed")]);
    const user = userEvent.setup();
    render(<RunsView pollMs={60_000} onSelect={onSelect} />);
    await screen.findAllByRole("button", { name: /plan-/ });
    await user.click(screen.getByRole("button", { name: "Failed" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /plan-/ })).toHaveLength(1));
    expect(asked.at(-1)!.searchParams.get("status")).toBe("failed");
    await user.click(screen.getByRole("button", { name: "Running" }));
    expect(await screen.findByText("No run matches this filter.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "All" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /plan-/ })).toHaveLength(2));
    expect(asked.at(-1)!.searchParams.has("status")).toBe(false);
  });

  it("moves focus between runs with the arrow keys", async () => {
    serve([item("r1", "passed"), item("r2", "passed")]);
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
    serve([item("r1", "passed")]);
    render(<RunsView pollMs={60_000} onSelect={onSelect} selectedId="r1" />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Latest" }));
    expect(onSelect).toHaveBeenCalledWith(undefined);
  });

  it("explains an empty list, and says plans come from Claude", async () => {
    serve([]);
    render(<RunsView pollMs={60_000} onSelect={onSelect} selectedId="r2" />);
    expect(await screen.findByText("No runs yet")).toBeTruthy();
    expect(screen.getByText(/Plans come from Claude/)).toBeTruthy();
  });

  it("shows a load error and loads again on request", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(500, { error: "boom" })).mockResolvedValue(reply(200, { runs: [item("r1", "passed")], total: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<RunsView pollMs={60_000} onSelect={onSelect} selectedId="r2" />);
    expect((await screen.findByRole("alert")).textContent).toContain("boom");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /plan-r1/ })).toBeTruthy();
  });

  it("does not start runs itself: no form, no start button, only the picker", async () => {
    serve([item("run-1", "passed")]);
    render(<RunsView onSelect={onSelect} />);
    await screen.findByRole("button", { name: /run-1/ });
    expect(screen.queryByText("Start a run")).toBeNull();
    expect(screen.queryByRole("button", { name: /start run/i })).toBeNull();
    expect(screen.queryByLabelText(/plan file/i)).toBeNull();
  });
});

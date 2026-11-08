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

beforeEach(() => {
  window.location.hash = "#/runs";
});
afterEach(() => vi.unstubAllGlobals());

describe("RunsView", () => {
  it("lists runs with status, progress and tokens per agent, each a link to its canvas", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { runs: [item("r1", "failed", 1500, 500), item("r2", "passed")] })));
    render(<RunsView pollMs={60_000} />);
    const links = await screen.findAllByRole("link", { name: /plan-/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["#/runs/r1", "#/runs/r2"]);
    expect(links[0]!.textContent).toContain("2 of 3 tasks · 1 failed");
    expect(links[0]!.textContent).toContain("Cursor2k");
    expect(links[0]!.textContent).toContain("Claude—");
    expect(links[0]!.textContent).toContain("Failed");
  });

  it("moves focus between runs with the arrow keys", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { runs: [item("r1", "passed"), item("r2", "passed")] })));
    const user = userEvent.setup();
    render(<RunsView pollMs={60_000} />);
    const links = await screen.findAllByRole("link", { name: /plan-/ });
    links[0]!.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(links[1]);
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(links[0]);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(links[1]);
  });

  it("explains an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { runs: [] })));
    render(<RunsView pollMs={60_000} />);
    expect(await screen.findByText("No runs yet")).toBeTruthy();
  });

  it("shows a load error and loads again on request", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(500, { error: "boom" })).mockResolvedValue(reply(200, { runs: [item("r1", "passed")] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<RunsView pollMs={60_000} />);
    expect((await screen.findByRole("alert")).textContent).toContain("boom");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: /plan-r1/ })).toBeTruthy();
  });

  it("starts a run with the form options and opens it on the canvas", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === "POST" ? reply(202, { runId: "new-1", pid: 5, logPath: "/l" }) : reply(200, { runs: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<RunsView pollMs={60_000} />);
    await screen.findByText("No runs yet");
    const submit = screen.getByRole("button", { name: "Start run" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.type(screen.getByLabelText(/plan file/i), "/work/plan.md");
    await user.click(screen.getByLabelText("Push"));
    await user.type(screen.getByLabelText("Max attempts"), "4");
    await user.click(submit);
    await waitFor(() => expect(window.location.hash).toBe("#/runs/new-1"));
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST")!;
    expect(post[0]).toBe("/api/runs");
    expect(JSON.parse(post[1]!.body as string)).toEqual({ planPath: "/work/plan.md", push: true, pr: false, maxAttempts: 4 });
  });

  it("shows why a run could not be started", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => (init?.method === "POST" ? reply(400, { error: "Invalid plan: no tasks" }) : reply(200, { runs: [] }))),
    );
    const user = userEvent.setup();
    render(<RunsView pollMs={60_000} />);
    await screen.findByText("No runs yet");
    await user.type(screen.getByLabelText(/plan file/i), "/work/plan.md");
    await user.click(screen.getByRole("button", { name: "Start run" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Invalid plan: no tasks");
    expect(window.location.hash).toBe("#/runs");
  });
});

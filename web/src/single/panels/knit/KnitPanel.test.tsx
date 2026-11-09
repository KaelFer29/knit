import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_FIXTURES } from "../../../fixtures/boards";
import { KnitPanel } from "./KnitPanel";

const reply = (status: number, body: unknown) => ({ ok: status < 400, status, statusText: "x", json: async () => body });
afterEach(() => vi.unstubAllGlobals());

const props = (board = ALL_FIXTURES.failedRun, live = true) => ({
  board,
  runId: board.runId,
  live,
  renderDetail: (t: { kind: string }) => <p>detail of {t.kind}</p>,
  selectRun: vi.fn(),
});

describe("KnitPanel", () => {
  it("shows the run header, the queue in order and run control for a failed run", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { runs: [] })));
    const p = props();
    render(<KnitPanel {...p} />);
    expect(screen.getByRole("heading", { name: p.board.planName })).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    const cards = screen.getAllByRole("button").filter((b) => b.className.includes("task-card__trigger"));
    expect(cards).toHaveLength(p.board.tasks.length);
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    await userEvent.setup().click(cards[0]!);
    expect(await screen.findByText("detail of task")).toBeTruthy();
    expect(await screen.findByText("No runs yet")).toBeTruthy();
  });

  it("hides run control for a fixture and says when there is no run", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { runs: [] })));
    const { unmount } = render(<KnitPanel {...props(ALL_FIXTURES.failedRun, false)} />);
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
    unmount();
    render(<KnitPanel {...props()} board={undefined} runId={undefined} />);
    expect(screen.getByText(/Ask Claude for a plan/)).toBeTruthy();
  });

  it("draws the run as five stages, each with what it holds now", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { runs: [] })));
    render(<KnitPanel {...props(ALL_FIXTURES.runningRun)} />);
    const stages = within(screen.getByRole("list", { name: "Run stages" }));
    expect(stages.getAllByRole("listitem").map((li) => li.querySelector(".pipe__label")?.textContent)).toEqual(["Plan", "Queue", "Build", "Checks", "Deliver"]);
    expect(stages.getByText("T3 · attempt 1")).toBeTruthy();
  });

  it("summarizes the run in numbers: delivered, attempts, tokens and time", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { runs: [] })));
    const p = props(ALL_FIXTURES.runningRun);
    render(<KnitPanel {...p} />);
    const summary = within(screen.getByRole("region", { name: "Run summary" }));
    expect(summary.getByText("Delivered").nextSibling?.textContent).toBe(`${p.board.totals.tasks.delivered} of ${p.board.totals.tasks.total}`);
    expect(summary.getByText("Attempts").nextSibling?.textContent).toBe(String(p.board.totals.attempts));
    expect(summary.getByText("Tokens")).toBeTruthy();
    expect(summary.getByText("Elapsed")).toBeTruthy();
  });

  it("has no form to start a run: runs start from Claude, with or without a run on screen", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { runs: [] })));
    const { unmount } = render(<KnitPanel {...props()} />);
    expect(screen.queryByText("Start a run")).toBeNull();
    expect(screen.queryByLabelText(/plan file/i)).toBeNull();
    unmount();
    render(<KnitPanel {...props()} board={undefined} runId={undefined} />);
    expect(screen.queryByText("Start a run")).toBeNull();
    expect(screen.queryByLabelText(/plan file/i)).toBeNull();
  });

  it("says where a run comes from when there is none: Claude drafts the plan and you send it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { runs: [] })));
    render(<KnitPanel {...props()} board={undefined} runId={undefined} />);
    expect(screen.getByRole("heading", { name: "No run yet" })).toBeTruthy();
    expect(screen.getByText(/Ask Claude for a plan/)).toBeTruthy();
    expect(await screen.findByText(/Plans come from Claude/)).toBeTruthy();
  });

  it("keeps the summary, the stages and the tasks together under the run, and the runs list apart", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { runs: [] })));
    const p = props(ALL_FIXTURES.runningRun);
    render(<KnitPanel {...p} />);
    const run = within(screen.getByRole("region", { name: `Run ${p.board.planName}` }));
    expect(run.getByRole("region", { name: "Run summary" })).toBeTruthy();
    expect(run.getByRole("list", { name: "Run stages" })).toBeTruthy();
    const tasks = run.getByRole("list", { name: "Tasks of this run" });
    expect(within(tasks).getAllByRole("listitem")).toHaveLength(p.board.tasks.length);
    expect(await screen.findByText("No runs yet")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: /^Runs/ })).queryByRole("list", { name: "Tasks of this run" })).toBeNull();
  });

  it("explains each number in the run summary when the pointer rests on it", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { runs: [] })));
    render(<KnitPanel {...props(ALL_FIXTURES.runningRun)} />);
    const summary = within(screen.getByRole("region", { name: "Run summary" }));
    for (const label of ["Delivered", "Attempts", "Tokens", "Elapsed"]) {
      expect(summary.getByText(label).closest("dt")?.getAttribute("title"), label).toBeTruthy();
    }
    expect(summary.getByText("Attempts").closest("dt")?.getAttribute("title")).toMatch(/failed check/i);
  });

  it("labels each task with the state of its pull request, read only when a task has one", async () => {
    const withPr = { ...ALL_FIXTURES.deliveredRun, tasks: ALL_FIXTURES.deliveredRun.tasks.map((t, i) => (i === 0 ? { ...t, prUrl: "https://example.test/pull/7" } : t)) };
    const first = withPr.tasks[0]!.taskId;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/branches")) return reply(200, { branches: [{ taskId: first, prUrl: "https://example.test/pull/7", prState: { state: "merged", base: "release/1.2" } }] });
      return reply(200, { runs: [], total: 0 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<KnitPanel {...props(withPr as typeof ALL_FIXTURES.deliveredRun)} />);
    expect(await screen.findByText("Merged into release/1.2")).toBeTruthy();
    expect(screen.getAllByText(/Merged into/)).toHaveLength(1);
  });

  it("does not ask for the branches when no task has a pull request, or for a sample run", async () => {
    const fetchMock = vi.fn(async (_url: string) => reply(200, { runs: [], total: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    const bare = { ...ALL_FIXTURES.failedRun, tasks: ALL_FIXTURES.failedRun.tasks.map((t) => ({ ...t, prUrl: undefined })) };
    const { unmount } = render(<KnitPanel {...props(bare as typeof ALL_FIXTURES.failedRun)} />);
    await screen.findByText("No runs yet");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/branches"))).toBe(false);
    unmount();
    const withPr = { ...ALL_FIXTURES.deliveredRun, tasks: ALL_FIXTURES.deliveredRun.tasks.map((t) => ({ ...t, prUrl: "https://example.test/pull/7" })) };
    render(<KnitPanel {...props(withPr as typeof ALL_FIXTURES.deliveredRun, false)} />);
    await screen.findByText("No runs yet");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/branches"))).toBe(false);
  });
});

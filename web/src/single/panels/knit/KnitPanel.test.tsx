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
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(String(p.board.totals.tasks.delivered));
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
    expect(screen.getByText(/No run to show yet/)).toBeTruthy();
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

  it("opens the form that starts a run when there is no run, instead of hiding it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { runs: [] })));
    render(<KnitPanel {...props()} board={undefined} runId={undefined} />);
    expect(screen.getByRole("heading", { name: "No run yet" })).toBeTruthy();
    expect(screen.getByLabelText("Plan file (absolute path)")).toBeTruthy();
    expect(await screen.findByText(/Start one from a plan file above/)).toBeTruthy();
  });

  it("keeps the form folded while a run is shown", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { runs: [] })));
    render(<KnitPanel {...props()} />);
    expect((screen.getByText("Start a run").closest("details") as HTMLDetailsElement).open).toBe(false);
  });
});

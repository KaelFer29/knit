import { render, screen } from "@testing-library/react";
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
});

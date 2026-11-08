import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_FIXTURES, deliveredRun, failedRun, legacyRun, longQueueRun, retryingRun, runningRun, verifyingRun } from "../fixtures/boards";
import { TASK_STATES, TASK_STATE_LABEL } from "../flow/status";
import { FlowCanvas } from "./FlowCanvas";

afterEach(() => vi.restoreAllMocks());

const block = (name: RegExp) => screen.getByRole("heading", { level: 2, name }).closest("article")!;

describe("FlowCanvas", () => {
  it("draws Claude, Knit and Cursor, in that order", () => {
    render(<FlowCanvas board={runningRun} />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent ?? "");
    expect(headings.map((t) => t.match(/Claude|Knit|Cursor/)?.[0])).toEqual(["Claude", "Knit", "Cursor"]);
  });

  it("shows what Claude handed over: the plan and its tasks", () => {
    render(<FlowCanvas board={runningRun} />);
    const claude = block(/Claude/);
    expect(claude.textContent).toContain("add-billing-webhooks");
    expect(claude.textContent).toContain("6 tasks");
    const delegated = within(claude).getByRole("list", { name: /delegated tasks/i });
    expect(within(delegated).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["T1, Delivered", "T2, Delivered", "T3, Running", "T4, Queued", "T5, Queued", "T6, Queued"]);
  });

  it("shows Knit's progress and no token count, since Knit never calls a model", () => {
    render(<FlowCanvas board={runningRun} />);
    const knit = block(/Knit/);
    expect(knit.textContent).toContain("2 of 6 delivered");
    expect(within(knit).queryByText(/tokens/i)).toBeNull();
  });

  it("puts the queue at Knit's input, the running task at its center and the delivery lane at its output", () => {
    render(<FlowCanvas board={runningRun} />);
    const knit = block(/Knit/);
    const queue = within(knit).getByRole("region", { name: "Queue" });
    const now = within(knit).getByRole("region", { name: "Running task" });
    const delivered = within(knit).getByRole("region", { name: "Delivered tasks" });
    expect(queue.compareDocumentPosition(now) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(now.compareDocumentPosition(delivered) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(queue).getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("Update subscription status"), expect.stringContaining("Send a receipt"), expect.stringContaining("Document the webhook")]);
    expect(now.textContent).toContain("Store events and make handling idempotent");
    expect(within(delivered).getAllByRole("link").map((a) => a.textContent)).toEqual([expect.stringContaining("PR #41"), expect.stringContaining("PR #42")]);
  });

  it("shows Cursor's token total and the single line of what it does now", () => {
    render(<FlowCanvas board={runningRun} />);
    const cursor = block(/Cursor/);
    expect(cursor.textContent).toContain("86.2k");
    expect(within(cursor).getByText("edit: src/billing/webhook-store.ts")).toBeTruthy();
  });

  it("keeps the live line in Cursor's block only when Cursor wrote it", () => {
    render(<FlowCanvas board={verifyingRun} />);
    // While Knit checks, the line belongs to Knit's check, not to the builder.
    expect(within(block(/Cursor/)).queryByText("pnpm typecheck", { selector: ".live-line__text" })).toBeNull();
    expect(within(block(/Cursor/)).getByText(/waiting/i)).toBeTruthy();
    expect(within(block(/Knit/)).getByText("pnpm typecheck")).toBeTruthy();
  });

  it("shows Claude's token total when sessions recorded some", () => {
    render(<FlowCanvas board={deliveredRun} />);
    expect(block(/Claude/).textContent).toContain("59.4k");
  });

  it("draws one wire strand per task from Claude, and the prompt and result strands of the tasks that used them", () => {
    const { container } = render(<FlowCanvas board={runningRun} />);
    const count = (wire: string) => container.querySelectorAll(`.wires path.wires__strand[data-wire='${wire}']`).length;
    expect(count("plan")).toBe(6);
    expect(count("prompt")).toBe(3);
    expect(count("result")).toBe(2);
  });

  it("walks the tab order from Claude to Knit, its queue, the running task, the delivered links, then Cursor", async () => {
    const user = userEvent.setup();
    render(<FlowCanvas board={runningRun} />);
    const order: string[] = [];
    for (let i = 0; i < 9; i += 1) {
      await user.tab();
      order.push((document.activeElement as HTMLElement).textContent ?? "");
    }
    const at = (needle: string) => order.findIndex((t) => t.includes(needle));
    expect(at("Claude")).toBe(0);
    expect(at("Knit")).toBe(1);
    expect([at("Update subscription"), at("Send a receipt"), at("Document the webhook"), at("Store events"), at("PR #41"), at("PR #42")]).toEqual([2, 3, 4, 5, 6, 7]);
    expect(at("Cursor")).toBe(8);
  });

  it("opens a block and a task with the keyboard and passes the detail slot through", async () => {
    const user = userEvent.setup();
    const renderDetail = vi.fn((t) => <p>{t.kind === "agent" ? `agent ${t.id}` : `task ${t.taskId}`}</p>);
    render(<FlowCanvas board={runningRun} renderDetail={renderDetail} />);
    await user.click(within(block(/Cursor/)).getByRole("button", { name: /Cursor/ }));
    expect(screen.getByText("agent cursor")).toBeTruthy();
    const card = within(screen.getByRole("region", { name: "Queue" })).getAllByRole("button")[0]!;
    card.focus();
    await user.keyboard("{Enter}");
    expect(card.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("task T4")).toBeTruthy();
  });

  it("lays out as a horizontal circuit when wide and as a vertical flow when narrow", () => {
    const { container, unmount } = render(<FlowCanvas board={runningRun} />);
    expect(container.querySelector(".flow")?.getAttribute("data-layout")).toBe("horizontal");
    unmount();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const width = this.classList.contains("flow") ? 736 : 100;
      return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 100, width, height: 100, toJSON: () => ({}) };
    });
    const narrow = render(<FlowCanvas board={runningRun} />);
    expect(narrow.container.querySelector(".flow")?.getAttribute("data-layout")).toBe("vertical");
  });

  it("draws a static highlight instead of a moving dot under reduced motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    const { container } = render(<FlowCanvas board={runningRun} pulses={[{ id: "a", wireId: "prompt:T3", kind: "prompt" }]} />);
    expect(container.querySelector("circle.wires__pulse")).toBeNull();
    expect(container.querySelector("path.wires__highlight")).not.toBeNull();
    vi.unstubAllGlobals();
  });

  it("moves a dot along the wire when motion is allowed", () => {
    const { container } = render(<FlowCanvas board={runningRun} pulses={[{ id: "a", wireId: "prompt:T3", kind: "prompt" }]} />);
    expect(container.querySelector("circle.wires__pulse")).not.toBeNull();
  });

  it("draws a fixture of every state, each with its label", () => {
    const seen = new Set<string>();
    for (const board of Object.values(ALL_FIXTURES)) {
      const { container, unmount } = render(<FlowCanvas board={board} />);
      for (const card of container.querySelectorAll(".task-card[data-state], .active-task__card[data-state]")) {
        const state = card.getAttribute("data-state") as keyof typeof TASK_STATE_LABEL;
        seen.add(state);
        expect(card.querySelector(".status-badge")?.textContent).toBe(TASK_STATE_LABEL[state]);
        expect(card.querySelector(".status-badge svg[data-icon]")?.getAttribute("data-icon")).toBe(state);
      }
      unmount();
    }
    expect([...seen].sort()).toEqual(TASK_STATES.filter((s) => s !== "delivered").sort());
  });

  it("shows delivered tasks as chips on the delivery lane and in Claude's list", () => {
    render(<FlowCanvas board={deliveredRun} />);
    expect(within(screen.getByRole("region", { name: "Delivered tasks" })).getAllByRole("listitem")).toHaveLength(3);
    expect(within(block(/Claude/)).getAllByText(/Delivered/)).toHaveLength(3);
  });

  it("shows the failed task at Knit's center when the run stopped", () => {
    render(<FlowCanvas board={failedRun} />);
    const now = screen.getByRole("region", { name: "Running task" });
    expect(now.textContent).toContain("Verify the signature of incoming events");
    expect(now.textContent).toContain("Failed");
    expect(block(/Knit/).textContent).toContain("Failed");
  });

  it("draws a run recorded before schema 4 without goals or dependencies", () => {
    render(<FlowCanvas board={legacyRun} />);
    expect(block(/Claude/).textContent).toContain("3 tasks");
    expect(screen.getByRole("region", { name: "Queue" }).textContent).not.toContain("Depends on");
  });

  it("folds a long queue", () => {
    render(<FlowCanvas board={longQueueRun} />);
    expect(screen.getByRole("button", { name: /show 2 more/i })).toBeTruthy();
  });

  it("shows the retrying state with its attempt", () => {
    render(<FlowCanvas board={retryingRun} />);
    const now = screen.getByRole("region", { name: "Running task" });
    expect(now.textContent).toContain("Retrying");
    expect(now.textContent).toContain("Attempt 2");
  });
});

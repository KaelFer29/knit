import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_FIXTURES } from "../fixtures/boards";
import { FlowView } from "./FlowView";

afterEach(() => vi.useRealTimers());

describe("FlowView", () => {
  it("draws the most representative fixture by default, with no switcher", () => {
    render(<FlowView search="" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("add-billing-webhooks");
    expect(screen.queryByRole("navigation", { name: /fixtures/i })).toBeNull();
    expect(screen.queryByText(/demo pulses/i)).toBeNull();
  });

  it("draws the fixture named in the query and shows the switcher with that one current", () => {
    render(<FlowView search="?fixture=deliveredRun" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("rename-config-keys");
    const nav = screen.getByRole("navigation", { name: /fixtures/i });
    const current = nav.querySelector("[aria-current='page']");
    expect(current?.textContent).toBe("Delivered");
    expect(current?.getAttribute("href")).toBe("?fixture=deliveredRun");
  });

  it("draws a live run from the API when the query names one", async () => {
    const detail = { board: { ...ALL_FIXTURES.deliveredRun, planName: "live-plan" }, lastEventId: 1, lastAgentEventId: 1 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => detail }));
    vi.stubGlobal("EventSource", class { addEventListener() {} close() {} });
    render(<FlowView search="?run=run-1" />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("live-plan");
    vi.unstubAllGlobals();
  });

  it("says why a live run could not be drawn", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found", json: async () => ({ error: "Run not found: nope" }) }));
    render(<FlowView search="?run=nope" />);
    expect((await screen.findByRole("alert")).textContent).toContain("Run not found: nope");
    vi.unstubAllGlobals();
  });

  it("offers a link per fixture", () => {
    render(<FlowView search="?fixture=runningRun" />);
    expect(screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("?fixture="))).toHaveLength(8);
  });

  it("states the run's progress in its header", () => {
    render(<FlowView search="?fixture=failedRun" />);
    const header = screen.getByRole("heading", { level: 1 }).closest(".run-header")!;
    expect(header.textContent).toContain("Failed");
    expect(header.textContent).toContain("1 of 4 delivered");
  });

  it("marks the demo pulses clearly and keeps them across fixtures", () => {
    render(<FlowView search="?fixture=runningRun&demo=1" />);
    const toggle = screen.getByRole("link", { name: /demo pulses: on/i });
    expect(toggle.getAttribute("href")).toBe("?fixture=runningRun");
    expect(screen.getByRole("link", { name: "Failed" }).getAttribute("href")).toBe("?fixture=failedRun&demo=1");
  });

  it("plays pulses on the fixture in demo mode, and drops each one when it arrives", () => {
    vi.useFakeTimers();
    const { container } = render(<FlowView search="?fixture=runningRun&demo=1" />);
    const dots = () => container.querySelectorAll("circle.wires__pulse");
    expect(dots()).toHaveLength(1);
    expect(dots()[0]?.getAttribute("data-kind")).toBe("dispatched");
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(dots()).toHaveLength(2);
    fireEvent.animationEnd(dots()[0]!);
    expect(dots()).toHaveLength(1);
    expect(dots()[0]?.getAttribute("data-kind")).toBe("prompt");
  });

  it("plays nothing without the demo parameter", () => {
    vi.useFakeTimers();
    const { container } = render(<FlowView search="?fixture=runningRun" />);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(container.querySelectorAll("circle.wires__pulse")).toHaveLength(0);
  });
});

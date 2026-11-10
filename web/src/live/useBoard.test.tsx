import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardModel } from "@board";
import { ALL_FIXTURES } from "../fixtures/boards";
import { useBoard, type RunDetail } from "./useBoard";

class FakeSource {
  static all: FakeSource[] = [];
  readyState = 1;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((e: unknown) => void)[]>();
  constructor(readonly url: string) {
    FakeSource.all.push(this);
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown, lastEventId = "") {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data), lastEventId });
  }
}
const eventSource = (url: string) => new FakeSource(url) as unknown as EventSource;

const board = (name: string): BoardModel => ({ ...ALL_FIXTURES.runningRun, planName: name });
const detail = (name: string): RunDetail => ({ board: board(name), lastEventId: 7, lastAgentEventId: 12 });

afterEach(() => {
  FakeSource.all = [];
});

describe("useBoard", () => {
  it("does nothing without a run id", () => {
    const fetchDetail = vi.fn();
    const { result } = renderHook(() => useBoard(undefined, { fetchDetail }));
    expect(result.current.connection).toBe("idle");
    expect(result.current.board).toBeUndefined();
    expect(fetchDetail).not.toHaveBeenCalled();
  });

  it("loads the board, streams from the snapshot's cursors and plays a pulse per lifecycle event", async () => {
    const fetchDetail = vi.fn().mockResolvedValue(detail("first"));
    const { result } = renderHook(() => useBoard("run-1", { fetchDetail, eventSource, refreshMs: 5 }));
    await waitFor(() => expect(result.current.board?.planName).toBe("first"));
    expect(FakeSource.all[0]!.url).toBe("/api/runs/run-1/stream?after=7.12");

    fetchDetail.mockResolvedValue(detail("second"));
    act(() => FakeSource.all[0]!.emit("event", { id: 8, type: "attempt.started", taskId: "T1" }, "8.12"));
    expect(result.current.pulses).toEqual([{ id: "live-8", wireId: "prompt:T1", kind: "prompt" }]);
    await waitFor(() => expect(result.current.board?.planName).toBe("second"));

    act(() => result.current.onPulseEnd("live-8"));
    expect(result.current.pulses).toEqual([]);
  });

  it("reopens on request: fetches the board again and a new stream from its cursors, closing the old one", async () => {
    const fetchDetail = vi.fn().mockResolvedValue(detail("first"));
    const { result } = renderHook(() => useBoard("run-1", { fetchDetail, eventSource, refreshMs: 5 }));
    await waitFor(() => expect(result.current.board?.planName).toBe("first"));
    // The run finished and its stream ended; then a follow-up starts: the page must listen again.
    fetchDetail.mockResolvedValue({ ...detail("second"), lastEventId: 30, lastAgentEventId: 44 });
    act(() => result.current.reopen());
    await waitFor(() => expect(result.current.board?.planName).toBe("second"));
    expect(FakeSource.all).toHaveLength(2);
    expect(FakeSource.all[0]!.closed).toBe(true);
    expect(FakeSource.all[1]!.url).toBe("/api/runs/run-1/stream?after=30.44");
  });

  it("refetches once for a burst of rows", async () => {
    const fetchDetail = vi.fn().mockResolvedValue(detail("x"));
    renderHook(() => useBoard("run-1", { fetchDetail, eventSource, refreshMs: 20 }));
    await waitFor(() => expect(FakeSource.all).toHaveLength(1));
    act(() => {
      for (let i = 0; i < 5; i++) FakeSource.all[0]!.emit("agent_event", { id: 13 + i, kind: "message" }, `7.${13 + i}`);
    });
    await waitFor(() => expect(fetchDetail).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 60));
    expect(fetchDetail).toHaveBeenCalledTimes(2);
  });

  it("closes the stream on done after a final refetch", async () => {
    const fetchDetail = vi.fn().mockResolvedValue(detail("a"));
    const { result } = renderHook(() => useBoard("run-1", { fetchDetail, eventSource, refreshMs: 5 }));
    await waitFor(() => expect(FakeSource.all).toHaveLength(1));
    fetchDetail.mockResolvedValue(detail("final"));
    act(() => FakeSource.all[0]!.emit("done", { status: "passed" }));
    expect(FakeSource.all[0]!.closed).toBe(true);
    expect(result.current.connection).toBe("closed");
    await waitFor(() => expect(result.current.board?.planName).toBe("final"));
  });

  it("closes the stream on unmount and reports a failed load", async () => {
    const fetchDetail = vi.fn().mockResolvedValue(detail("a"));
    const { unmount } = renderHook(() => useBoard("run-1", { fetchDetail, eventSource }));
    await waitFor(() => expect(FakeSource.all).toHaveLength(1));
    unmount();
    expect(FakeSource.all[0]!.closed).toBe(true);

    const failing = vi.fn().mockRejectedValue(new Error("Run not found: nope"));
    const { result } = renderHook(() => useBoard("nope", { fetchDetail: failing, eventSource }));
    await waitFor(() => expect(result.current.error).toBe("Run not found: nope"));
    expect(FakeSource.all).toHaveLength(1);
  });
});

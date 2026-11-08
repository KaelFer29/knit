import { afterEach, describe, expect, it, vi } from "vitest";
import { openRunStream } from "./stream";

class FakeSource {
  static all: FakeSource[] = [];
  readyState = 0;
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
    this.readyState = 2;
  }
  emit(type: string, data: unknown, lastEventId = "") {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data), lastEventId });
  }
}
const factory = (url: string) => new FakeSource(url) as unknown as EventSource;

afterEach(() => {
  FakeSource.all = [];
  vi.useRealTimers();
});

describe("openRunStream", () => {
  it("starts after the given cursor and delivers events and agent events", () => {
    const events: unknown[] = [];
    const agents: unknown[] = [];
    openRunStream("run-1", { onEvent: (e) => events.push(e), onAgentEvent: (a) => agents.push(a) }, { after: "4.9", eventSource: factory });
    const es = FakeSource.all[0]!;
    expect(es.url).toBe("/api/runs/run-1/stream?after=4.9");
    es.emit("event", { id: 5, type: "attempt.started" }, "5.9");
    es.emit("agent_event", { id: 10, kind: "message" }, "5.10");
    expect(events).toEqual([{ id: 5, type: "attempt.started" }]);
    expect(agents).toEqual([{ id: 10, kind: "message" }]);
  });

  it("closes on done and never reconnects", () => {
    vi.useFakeTimers();
    const done = vi.fn();
    openRunStream("run-1", { onDone: done }, { eventSource: factory });
    const es = FakeSource.all[0]!;
    es.emit("done", { status: "passed" });
    expect(es.closed).toBe(true);
    expect(done).toHaveBeenCalledWith("passed");
    es.onerror?.();
    vi.advanceTimersByTime(60_000);
    expect(FakeSource.all).toHaveLength(1);
  });

  it("reopens from the last cursor when the browser gives up, with a growing delay", () => {
    vi.useFakeTimers();
    const states: string[] = [];
    openRunStream("run-1", { onConnection: (s) => states.push(s) }, { eventSource: factory, retryMs: 100 });
    FakeSource.all[0]!.emit("event", { id: 3, type: "x" }, "3.7");
    FakeSource.all[0]!.close();
    FakeSource.all[0]!.onerror?.();
    vi.advanceTimersByTime(99);
    expect(FakeSource.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSource.all[1]!.url).toBe("/api/runs/run-1/stream?after=3.7");
    FakeSource.all[1]!.close();
    FakeSource.all[1]!.onerror?.();
    vi.advanceTimersByTime(199);
    expect(FakeSource.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSource.all).toHaveLength(3);
    expect(states).toContain("reconnecting");
  });

  it("lets the browser retry by itself while it is still connecting", () => {
    vi.useFakeTimers();
    openRunStream("run-1", {}, { eventSource: factory });
    FakeSource.all[0]!.onerror?.();
    vi.advanceTimersByTime(60_000);
    expect(FakeSource.all).toHaveLength(1);
  });

  it("stops for good when closed by the caller", () => {
    vi.useFakeTimers();
    const close = openRunStream("run-1", {}, { eventSource: factory, retryMs: 10 });
    FakeSource.all[0]!.close();
    FakeSource.all[0]!.onerror?.();
    close();
    vi.advanceTimersByTime(1_000);
    expect(FakeSource.all).toHaveLength(1);
  });
});

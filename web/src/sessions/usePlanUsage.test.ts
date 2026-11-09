import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlanUsage } from "./usePlanUsage";

let calls = 0;
beforeEach(() => {
  calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      calls += 1;
      return new Response(JSON.stringify({ windows: [{ label: "Current session", percent: 30 + calls }], checkedAt: "x" }), { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("usePlanUsage", () => {
  it("reads at once, then again every interval while it is on", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => usePlanUsage("claude", true, 1000));
    await waitFor(() => expect(result.current.windows[0]?.percent).toBe(31));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await waitFor(() => expect(result.current.windows[0]?.percent).toBe(32));
  });

  it("does nothing while it is off", async () => {
    renderHook(() => usePlanUsage("claude", false, 1000));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(0);
  });
});

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetSessionTitles, useSessionTitles } from "./useSessionTitles";

beforeEach(() => {
  window.localStorage.clear();
  resetSessionTitles();
});

describe("useSessionTitles", () => {
  it("gives a name to a session and falls back to its own title", () => {
    const { result } = renderHook(() => useSessionTitles());
    expect(result.current.titleOf("s1", "/usage")).toBe("/usage");
    act(() => result.current.rename("s1", "prueba cursor"));
    expect(result.current.titleOf("s1", "/usage")).toBe("prueba cursor");
    act(() => result.current.rename("s1", "  "));
    expect(result.current.titleOf("s1", "/usage")).toBe("/usage");
  });

  it("shares a rename with every other user of the hook at once", () => {
    const panel = renderHook(() => useSessionTitles());
    const block = renderHook(() => useSessionTitles());
    act(() => panel.result.current.rename("s1", "prueba cursor"));
    expect(block.result.current.titleOf("s1", "/usage")).toBe("prueba cursor");
  });

  it("keeps the name for the next visit", () => {
    const first = renderHook(() => useSessionTitles());
    act(() => first.result.current.rename("s1", "prueba cursor"));
    first.unmount();
    const second = renderHook(() => useSessionTitles());
    expect(second.result.current.titleOf("s1", "/usage")).toBe("prueba cursor");
  });
});

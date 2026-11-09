import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AGENTS } from "../identity/agents";
import { Logo } from "./Logo";

describe("Logo", () => {
  it("requests the official logo file and shows the monogram until it loads", () => {
    const { container } = render(<Logo identity={AGENTS.claude} />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/brand/claude.svg");
    expect(screen.getByText("✻")).toBeTruthy();
    expect(container.querySelector("[data-state]")?.getAttribute("data-state")).toBe("loading");
  });

  it("hides the monogram once the file has loaded", () => {
    const { container } = render(<Logo identity={AGENTS.cursor} />);
    fireEvent.load(container.querySelector("img") as HTMLImageElement);
    expect(container.querySelector("[data-state]")?.getAttribute("data-state")).toBe("ready");
    expect(screen.queryByText("C")).toBeNull();
  });

  it("falls back to the monogram when the file is missing", () => {
    const { container } = render(<Logo identity={AGENTS.cursor} />);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-mark="pointer"]')).toBeTruthy();
    expect(container.querySelector("[data-state]")?.getAttribute("data-state")).toBe("fallback");
  });

  it("tries again when the identity points at another file", () => {
    const { container, rerender } = render(<Logo identity={AGENTS.claude} />);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(container.querySelector("img")).toBeNull();
    rerender(<Logo identity={AGENTS.cursor} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/brand/cursor.svg");
  });

  it("draws Knit's own mark without requesting any file", () => {
    const { container } = render(<Logo identity={AGENTS.knit} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("[data-state]")?.getAttribute("data-state")).toBe("mark");
  });

  it("is decorative: the label next to it names the agent", () => {
    const { container } = render(<Logo identity={AGENTS.claude} />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });
});

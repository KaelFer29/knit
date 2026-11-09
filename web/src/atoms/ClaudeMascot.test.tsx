import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClaudeMascot } from "./ClaudeMascot";

describe("ClaudeMascot", () => {
  it("is a drawing, not text: it keeps its shape in any font, and is hidden from assistive technology", () => {
    const { container } = render(<ClaudeMascot className="x" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.classList.contains("x")).toBe(true);
    expect(container.textContent).toBe("");
  });

  it("has two eyes cut out of the body and four legs", () => {
    const { container } = render(<ClaudeMascot />);
    expect(container.querySelectorAll("[data-part='leg']")).toHaveLength(4);
    expect(container.querySelector("[data-part='body']")?.getAttribute("fill-rule")).toBe("evenodd");
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClaudeAtWork } from "./ClaudeAtWork";

describe("ClaudeAtWork", () => {
  it("shows Claude at work while a turn runs", () => {
    render(<ClaudeAtWork working tokens={{ input: 48_200, output: 3_100 }} />);
    expect(screen.getByRole("status").textContent).toMatch(/working/i);
    expect(screen.getByText("51.3k tokens in this conversation")).toBeTruthy();
  });

  it("rests when nothing runs, and hides the token line before any turn counted", () => {
    render(<ClaudeAtWork working={false} tokens={{ input: 0, output: 0 }} />);
    expect(screen.getByRole("status").textContent).toMatch(/ready/i);
    expect(screen.queryByText(/tokens in this conversation/)).toBeNull();
  });
});

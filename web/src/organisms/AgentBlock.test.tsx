import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AGENTS } from "../identity/agents";
import { AgentBlock } from "./AgentBlock";

const line = { source: "cursor", kind: "tool_started", text: "edit: src/billing/webhook-store.ts", ts: "2026-11-03T09:21:00.000Z", eventId: 1 };

describe("AgentBlock", () => {
  it("shows the identity: label, role and status", () => {
    render(<AgentBlock identity={AGENTS.cursor} status="working" />);
    const button = screen.getByRole("button");
    expect(button.textContent).toContain("Cursor");
    expect(button.textContent).toContain("builder");
    expect(button.textContent).toContain("Working");
  });

  it.each([
    ["idle", "Idle"],
    ["working", "Working"],
    ["done", "Done"],
    ["failed", "Failed"],
  ] as const)("labels the %s status as %s", (status, label) => {
    render(<AgentBlock identity={AGENTS.knit} status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it("shows the token total, with the split in the tooltip", () => {
    render(<AgentBlock identity={AGENTS.cursor} status="working" tokens={{ input: 38_200, output: 4_900 }} />);
    const total = screen.getByText("43.1k");
    expect(total.closest("[title]")?.getAttribute("title")).toBe("38,200 in · 4,900 out");
    expect(screen.getByText(/38\.2k in/)).toBeTruthy();
  });

  it("says when no usage is recorded", () => {
    render(<AgentBlock identity={AGENTS.claude} status="done" tokens={{ input: 0, output: 0 }} />);
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText(/none recorded/i)).toBeTruthy();
  });

  it("omits tokens when the block has no model usage to report", () => {
    render(<AgentBlock identity={AGENTS.knit} status="working" />);
    expect(screen.queryByText(/tokens/i)).toBeNull();
  });

  it("shows the single live line of what the agent is doing right now", () => {
    render(<AgentBlock identity={AGENTS.cursor} status="working" showLive liveLine={line} />);
    expect(screen.getByText("edit: src/billing/webhook-store.ts")).toBeTruthy();
    expect(screen.getByText(/^now/i)).toBeTruthy();
  });

  it("shows a quiet line when the agent has nothing to say", () => {
    render(<AgentBlock identity={AGENTS.cursor} status="idle" showLive idleText="Waiting for the next prompt" />);
    expect(screen.getByText("Waiting for the next prompt")).toBeTruthy();
  });

  it("renders the live line as text", () => {
    const { container } = render(<AgentBlock identity={AGENTS.cursor} status="working" showLive liveLine={{ ...line, text: "<b>bold</b>" }} />);
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText("<b>bold</b>")).toBeTruthy();
  });

  it("is a disclosure: aria-expanded, Enter and Space, and a detail slot", async () => {
    const user = userEvent.setup();
    const renderDetail = vi.fn(() => <p>plan text</p>);
    render(<AgentBlock identity={AGENTS.claude} status="done" renderDetail={renderDetail} />);
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(renderDetail).not.toHaveBeenCalled();
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.keyboard("{Enter}");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(renderDetail).toHaveBeenCalledWith({ kind: "agent", id: "claude" });
    expect(screen.getByText("plan text")).toBeTruthy();
    await user.keyboard(" ");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("plan text")).toBeNull();
  });

  it("shows a tidy empty detail when nothing fills the slot", async () => {
    const user = userEvent.setup();
    render(<AgentBlock identity={AGENTS.knit} status="working" />);
    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("region").textContent).toMatch(/no detail/i);
  });

  it("hosts its content (the queue, the running task...) as children", () => {
    render(
      <AgentBlock identity={AGENTS.knit} status="working">
        <p>inside knit</p>
      </AgentBlock>,
    );
    expect(screen.getByText("inside knit")).toBeTruthy();
  });
});

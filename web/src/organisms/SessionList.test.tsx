import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AgentView, SessionListEntry } from "../sessions/types";
import { SessionList } from "./SessionList";

const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const caps = { resume: true, chooseModel: false, commandList: false, visibleReasoning: false, planUsage: false };
const agents: AgentView[] = [{ id: "zed", label: "Zed", capabilities: caps, profileFields: [] }];
const entry = (id: string, over: Partial<SessionListEntry["session"]> = {}, rest: Partial<SessionListEntry> = {}): SessionListEntry => ({
  session: { id, agent: "zed", title: `Title ${id}`, cwd: "/r", createdAt: "x", updatedAt: "2026-11-08T11:55:00.000Z", status: "idle", ...over },
  turnCount: 2,
  inputTokens: 1000,
  outputTokens: 500,
  ...rest,
});

describe("SessionList", () => {
  it("lists sessions with time, turns and tokens, and marks the open one", () => {
    render(<SessionList sessions={[entry("a"), entry("b")]} agents={agents} selectedId="b" now={NOW} onSelect={() => {}} onNew={() => {}} />);
    const rows = screen.getAllByRole("button", { name: /Title/ });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("5m ago");
    expect(rows[0]!.textContent).toContain("2 turns");
    expect(rows[0]!.textContent).toContain("1.5k tokens");
    expect(rows[1]!.getAttribute("aria-current")).toBe("true");
    expect(rows[0]!.getAttribute("aria-current")).toBeNull();
  });

  it("shows a running session as running instead of a time", () => {
    render(<SessionList sessions={[entry("a", { status: "running" })]} agents={agents} selectedId={undefined} now={NOW} onSelect={() => {}} onNew={() => {}} />);
    expect(screen.getByText("Running")).toBeTruthy();
  });

  it("selects a session and starts a new one with the keyboard or the mouse", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onNew = vi.fn();
    render(<SessionList sessions={[entry("a")]} agents={agents} selectedId={undefined} now={NOW} onSelect={onSelect} onNew={onNew} />);
    await user.click(screen.getByRole("button", { name: /Title a/ }));
    expect(onSelect).toHaveBeenCalledWith("a");
    screen.getByRole("button", { name: "New session" }).focus();
    await user.keyboard("{Enter}");
    expect(onNew).toHaveBeenCalledOnce();
  });

  it("explains an empty list", () => {
    render(<SessionList sessions={[]} agents={agents} selectedId={undefined} now={NOW} onSelect={() => {}} onNew={() => {}} />);
    expect(screen.getByText(/No sessions yet/)).toBeTruthy();
  });

  it("treats the singular turn and a session of an unknown agent", () => {
    render(<SessionList sessions={[entry("a", { agent: "other" }, { turnCount: 1, inputTokens: 0, outputTokens: 0 })]} agents={agents} selectedId={undefined} now={NOW} onSelect={() => {}} onNew={() => {}} />);
    const row = screen.getByRole("button", { name: /Title a/ });
    expect(row.textContent).toContain("1 turn");
    expect(row.textContent).not.toContain("tokens");
  });
});

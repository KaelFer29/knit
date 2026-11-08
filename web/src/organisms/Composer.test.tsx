import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { paletteCommands } from "../sessions/commands";
import type { AgentView } from "../sessions/types";
import { Composer } from "./Composer";

const agent = (over: Partial<AgentView["capabilities"]> = {}, profileFields: AgentView["profileFields"] = ["model"]): AgentView => ({
  id: "x",
  label: "Zed",
  capabilities: { resume: true, chooseModel: true, commandList: true, visibleReasoning: false, planUsage: false, ...over },
  profileFields,
});

function setup(a: AgentView = agent(), over: Partial<Parameters<typeof Composer>[0]> = {}) {
  const props = {
    agent: a,
    models: ["m1", "m2"],
    profile: {},
    onProfileChange: vi.fn(),
    commands: paletteCommands(a, ["compact", "review"]),
    onSubmit: vi.fn().mockResolvedValue(true),
    onKnitCommand: vi.fn(),
    busy: false,
    ...over,
  };
  render(<Composer {...props} />);
  return { props, field: screen.getByRole("combobox", { name: /message zed/i }) as HTMLTextAreaElement };
}

describe("Composer", () => {
  it("sends the text with Enter, clears the field, and keeps Shift+Enter for new lines", async () => {
    const user = userEvent.setup();
    const { props, field } = setup();
    await user.type(field, "hello{Shift>}{Enter}{/Shift}there");
    expect(field.value).toBe("hello\nthere");
    await user.keyboard("{Enter}");
    expect(props.onSubmit).toHaveBeenCalledWith("hello\nthere");
    expect(field.value).toBe("");
  });

  it("keeps the text when the send was refused", async () => {
    const user = userEvent.setup();
    const { field } = setup(agent(), { onSubmit: vi.fn().mockResolvedValue(false) });
    await user.type(field, "keep me{Enter}");
    expect(field.value).toBe("keep me");
  });

  it("opens the palette for a slash and lists Knit's commands and the agent's own", async () => {
    const user = userEvent.setup();
    const { field } = setup();
    await user.type(field, "/");
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options[0]).toContain("/clear");
    expect(options.some((o) => o?.includes("/compact"))).toBe(true);
    expect(field.getAttribute("aria-expanded")).toBe("true");
  });

  it("filters while typing and completes an agent command into the field with Enter, without sending it", async () => {
    const user = userEvent.setup();
    const { props, field } = setup();
    await user.type(field, "/rev{Enter}");
    expect(field.value).toBe("/review ");
    expect(props.onSubmit).not.toHaveBeenCalled();
    await user.type(field, "now{Enter}");
    expect(props.onSubmit).toHaveBeenCalledWith("/review now");
  });

  it("moves through the list with the arrows and closes it with Escape", async () => {
    const user = userEvent.setup();
    const { field } = setup();
    await user.type(field, "/");
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(field.value).toBe("/");
  });

  it("runs a Knit command instead of sending it", async () => {
    const user = userEvent.setup();
    const { props, field } = setup();
    await user.type(field, "/clear{Enter}");
    expect(props.onKnitCommand).toHaveBeenCalledWith("clear");
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(field.value).toBe("");
  });

  it("moves focus to the model field for /model", async () => {
    const user = userEvent.setup();
    const { props, field } = setup();
    await user.type(field, "/model{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: /model/i, hidden: false }));
    expect(props.onKnitCommand).not.toHaveBeenCalled();
  });

  it("does not send while busy, and says why", async () => {
    const user = userEvent.setup();
    const { props, field } = setup(agent(), { busy: true, busyLabel: "A turn is running…" });
    await user.type(field, "hi{Enter}");
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("A turn is running…")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the model picker only for an agent that can choose a model, and only the fields it takes", () => {
    setup(agent({ chooseModel: false }, ["model", "effort"]));
    expect(screen.queryByLabelText("Model")).toBeNull();
    expect(screen.getByLabelText("Effort")).toBeTruthy();
    expect(screen.queryByLabelText("Permission mode")).toBeNull();
  });

  it("reports the picked model through onProfileChange", async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.selectOptions(screen.getByLabelText("Model"), "m2");
    expect(props.onProfileChange).toHaveBeenCalledWith({ model: "m2" });
  });

  it("falls back to free text for the model when the agent listed none", () => {
    setup(agent(), { models: [] });
    expect(screen.getByLabelText("Model").tagName).toBe("INPUT");
  });

  it("shows an error as an alert", () => {
    setup(agent(), { error: "Session is busy" });
    expect(screen.getByRole("alert").textContent).toBe("Session is busy");
  });
});

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

function baseProps(a: AgentView, over: Partial<Parameters<typeof Composer>[0]> = {}): Parameters<typeof Composer>[0] {
  return {
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
}

function setup(a: AgentView = agent(), over: Partial<Parameters<typeof Composer>[0]> = {}) {
  const props = baseProps(a, over);
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

  it("opens the model menu for /model", async () => {
    const user = userEvent.setup();
    const { props, field } = setup();
    await user.type(field, "/model{Enter}");
    expect(screen.getByRole("dialog", { name: "Model and effort" })).toBeTruthy();
    expect(props.onKnitCommand).not.toHaveBeenCalled();
  });

  it("opens the command palette from its button", async () => {
    const user = userEvent.setup();
    const { field } = setup();
    await user.click(screen.getByRole("button", { name: "Commands" }));
    expect(field.value).toBe("/");
    expect(screen.getByRole("listbox", { name: "Commands" })).toBeTruthy();
    expect(document.activeElement).toBe(field);
  });

  it("does not send while busy, and says why", async () => {
    const user = userEvent.setup();
    const { props, field } = setup(agent(), { busy: true, busyLabel: "A turn is running…" });
    await user.type(field, "hi{Enter}");
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("A turn is running…")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the model chip only for an agent that can choose a model, and only the fields it takes", () => {
    const first = render(<Composer {...baseProps(agent({ chooseModel: false }, ["model", "effort"]))} />);
    expect(screen.getByRole("button", { name: "Model and effort" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Permission mode" })).toBeNull();
    first.unmount();
    render(<Composer {...baseProps(agent({ chooseModel: false }, ["permissionMode"]))} />);
    expect(screen.queryByRole("button", { name: "Model and effort" })).toBeNull();
    expect(screen.getByRole("button", { name: "Permission mode" })).toBeTruthy();
  });

  it("reports the picked model through onProfileChange", async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.click(screen.getByRole("button", { name: "Model and effort" }));
    await user.click(screen.getByRole("radio", { name: "m2" }));
    expect(props.onProfileChange).toHaveBeenCalledWith({ model: "m2" });
  });

  it("sends with a round button that is named Send", async () => {
    const user = userEvent.setup();
    const { props, field } = setup();
    await user.type(field, "go");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(props.onSubmit).toHaveBeenCalledWith("go");
  });

  it("shows an error as an alert", () => {
    setup(agent(), { error: "Session is busy" });
    expect(screen.getByRole("alert").textContent).toBe("Session is busy");
  });
});

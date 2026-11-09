import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AgentView, Profile } from "../sessions/types";
import { ProfileBar } from "./ProfileBar";

const caps = { resume: true, chooseModel: true, commandList: false, visibleReasoning: false, planUsage: false };
const agent = (c: Partial<typeof caps> = {}, fields: AgentView["profileFields"] = ["model", "effort", "permissionMode"]): AgentView => ({ id: "a", label: "Alpha", capabilities: { ...caps, ...c }, profileFields: fields });

function setup(a = agent(), profile: Profile = {}, models = ["fast", "deep"]) {
  const onChange = vi.fn();
  render(<ProfileBar agent={a} models={models} profile={profile} onChange={onChange} />);
  return onChange;
}

describe("ProfileBar", () => {
  it("shows one chip with the model and the effort, and one with the permission mode", () => {
    setup(agent(), { model: "deep", effort: "high", permissionMode: "plan" });
    expect(screen.getByRole("button", { name: "Model and effort" }).textContent).toContain("deep");
    expect(screen.getByRole("button", { name: "Model and effort" }).textContent).toContain("high");
    expect(screen.getByRole("button", { name: "Permission mode" }).textContent).toContain("Permissions: Plan");
  });

  it("falls back to Default when nothing is chosen", () => {
    setup();
    expect(screen.getByRole("button", { name: "Model and effort" }).textContent).toContain("Default model");
    expect(screen.getByRole("button", { name: "Permission mode" }).textContent).toContain("Permissions: Default");
  });

  it("picks a model from the list and reports it", async () => {
    const user = userEvent.setup();
    const onChange = setup();
    await user.click(screen.getByRole("button", { name: "Model and effort" }));
    const models = within(screen.getByRole("radiogroup", { name: "Model" }));
    expect(models.getByRole("radio", { name: "Default" }).getAttribute("aria-checked")).toBe("true");
    await user.click(models.getByRole("radio", { name: "deep" }));
    expect(onChange).toHaveBeenCalledWith({ model: "deep" });
  });

  it("picks an effort, and clears a choice with Default", async () => {
    const user = userEvent.setup();
    const onChange = setup(agent(), { model: "deep", effort: "low" });
    await user.click(screen.getByRole("button", { name: "Model and effort" }));
    const effort = screen.getByRole("radiogroup", { name: "Effort" });
    expect(within(effort).getByRole("radio", { name: "low" }).getAttribute("aria-checked")).toBe("true");
    await user.click(within(effort).getByRole("radio", { name: "high" }));
    expect(onChange).toHaveBeenLastCalledWith({ model: "deep", effort: "high" });
    await user.click(within(effort).getByRole("radio", { name: "Default" }));
    expect(onChange).toHaveBeenLastCalledWith({ model: "deep" });
  });

  it("picks a permission mode with a readable name", async () => {
    const user = userEvent.setup();
    const onChange = setup();
    await user.click(screen.getByRole("button", { name: "Permission mode" }));
    await user.click(screen.getByRole("radio", { name: "Accept edits" }));
    expect(onChange).toHaveBeenCalledWith({ permissionMode: "acceptEdits" });
  });

  it("offers a text field for the model when the agent listed none", async () => {
    const user = userEvent.setup();
    const onChange = setup(agent(), {}, []);
    await user.click(screen.getByRole("button", { name: "Model and effort" }));
    await user.type(screen.getByRole("textbox", { name: "Model" }), "x");
    expect(onChange).toHaveBeenLastCalledWith({ model: "x" });
  });

  it("shows only what the agent takes: no model without the capability, nothing without fields", () => {
    setup(agent({ chooseModel: false }, ["model", "effort"]));
    expect(screen.queryByRole("button", { name: "Permission mode" })).toBeNull();
    expect(screen.getByRole("button", { name: "Model and effort" }).textContent).not.toContain("Default model");
  });

  it("renders nothing for an agent with no profile fields", () => {
    const { container } = render(<ProfileBar agent={agent({}, [])} models={[]} profile={{}} onChange={() => {}} />);
    expect(container.textContent).toBe("");
  });

  it("closes with Escape and gives the focus back to its chip", async () => {
    const user = userEvent.setup();
    setup();
    const chip = screen.getByRole("button", { name: "Model and effort" });
    await user.click(chip);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Model and effort" })).toBeNull();
    expect(document.activeElement).toBe(chip);
  });
});

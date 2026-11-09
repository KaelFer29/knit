import { fireEvent, render, screen, within } from "@testing-library/react";
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

  it("lists the models by name with a description, the agent's default first, and reports the pick", async () => {
    const user = userEvent.setup();
    const onChange = setup(agent(), {}, ["sonnet", "opus", "claude-sonnet-5-5"]);
    await user.click(screen.getByRole("button", { name: "Model and effort" }));
    const models = within(screen.getByRole("radiogroup", { name: "Model" }));
    expect(models.getAllByRole("radio").map((r) => r.getAttribute("aria-label"))).toEqual(["Default (recommended)", "Sonnet 5.5", "Opus 5.5"]);
    expect(models.getByRole("radio", { name: "Default (recommended)" }).getAttribute("aria-checked")).toBe("true");
    expect(models.getByText("Most efficient for simpler tasks")).toBeTruthy();
    await user.click(models.getByRole("radio", { name: "Opus 5.5" }));
    expect(onChange).toHaveBeenCalledWith({ model: "opus" });
  });

  it("shows the model chip with the model's name", () => {
    setup(agent(), { model: "sonnet" }, ["sonnet"]);
    expect(screen.getByRole("button", { name: "Model and effort" }).textContent).toContain("Sonnet 5.5");
  });

  it("sets the effort with a slider that moves along five levels, Default at the start, and reports it", async () => {
    const user = userEvent.setup();
    const onChange = setup(agent(), { model: "deep" });
    await user.click(screen.getByRole("button", { name: "Model and effort" }));
    const slider = screen.getByRole("slider", { name: "Effort" }) as HTMLInputElement;
    expect(slider.getAttribute("aria-valuetext")).toBe("Default");
    expect(slider.max).toBe("5");
    fireEvent.change(slider, { target: { value: "3" } });
    expect(onChange).toHaveBeenLastCalledWith({ model: "deep", effort: "high" });
    fireEvent.change(slider, { target: { value: "5" } });
    expect(onChange).toHaveBeenLastCalledWith({ model: "deep", effort: "max" });
  });

  it("reads the effort in use on the slider, and clears it at the start", async () => {
    const user = userEvent.setup();
    const onChange = setup(agent(), { model: "deep", effort: "medium" });
    await user.click(screen.getByRole("button", { name: "Model and effort" }));
    const slider = screen.getByRole("slider", { name: "Effort" }) as HTMLInputElement;
    expect(slider.value).toBe("2");
    expect(screen.getByText("Effort (medium)")).toBeTruthy();
    fireEvent.change(slider, { target: { value: "0" } });
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

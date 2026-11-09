import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RouteSwitch } from "./RouteSwitch";

describe("RouteSwitch", () => {
  it("turns on and off", async () => {
    const onChange = vi.fn();
    render(<RouteSwitch on={false} onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("switch", { name: "Send to the orchestrator" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("can be disabled with the reason, and then does nothing", async () => {
    const onChange = vi.fn();
    render(<RouteSwitch on={false} onChange={onChange} disabled reason="Off while iterating on T1" />);
    const button = screen.getByRole("switch", { name: "Send to the orchestrator" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toBe("Off while iterating on T1");
    await userEvent.setup().click(button);
    expect(onChange).not.toHaveBeenCalled();
  });
});

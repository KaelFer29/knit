import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TaskState } from "@board";
import { TASK_STATES, TASK_STATE_LABEL } from "../flow/status";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it.each(TASK_STATES)("shows a text label and an icon for %s", (state: TaskState) => {
    const { container } = render(<StatusBadge state={state} />);
    expect(screen.getByText(TASK_STATE_LABEL[state])).toBeTruthy();
    const icon = container.querySelector("svg[data-icon]");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(container.firstElementChild?.getAttribute("data-state")).toBe(state);
  });

  it("gives every state its own icon, so the state never relies on color alone", () => {
    const icons = TASK_STATES.map((state) => {
      const { container, unmount } = render(<StatusBadge state={state} />);
      const name = container.querySelector("svg")?.getAttribute("data-icon");
      unmount();
      return name;
    });
    expect(new Set(icons).size).toBe(TASK_STATES.length);
  });

  it("lets a block borrow a state's look with its own label", () => {
    const { container } = render(<StatusBadge state="delivered" label="Done" />);
    expect(screen.getByText("Done")).toBeTruthy();
    expect(container.firstElementChild?.getAttribute("data-state")).toBe("delivered");
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaskCard, type TaskCardData } from "./TaskCard";

const task: TaskCardData = { taskId: "T4", title: "Update subscription status from events", position: 4, state: "queued", attempts: 0, dependsOn: "T3" };

describe("TaskCard", () => {
  it("shows the position, the title, the state and the dependency", () => {
    render(<TaskCard task={task} />);
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("Update subscription status from events")).toBeTruthy();
    expect(screen.getByText("Queued")).toBeTruthy();
    expect(screen.getByRole("button").textContent).toContain("Depends on T3");
  });

  it("counts attempts only when there are some", () => {
    const { rerender } = render(<TaskCard task={task} />);
    expect(screen.queryByText(/attempt/)).toBeNull();
    rerender(<TaskCard task={{ ...task, state: "retrying", attempts: 1 }} />);
    expect(screen.getByText("1 attempt")).toBeTruthy();
    rerender(<TaskCard task={{ ...task, state: "failed", attempts: 3 }} />);
    expect(screen.getByText("3 attempts")).toBeTruthy();
  });

  it("omits the dependency when the task has none", () => {
    render(<TaskCard task={{ ...task, dependsOn: undefined }} />);
    expect(screen.getByRole("button").textContent).not.toContain("Depends");
  });

  it("is a disclosure button that opens an empty detail state by default", async () => {
    const user = userEvent.setup();
    render(<TaskCard task={task} />);
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region")).toBeNull();
    await user.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const panel = screen.getByRole("region");
    expect(button.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.textContent).toMatch(/no detail/i);
  });

  it("toggles with Enter and with Space", async () => {
    const user = userEvent.setup();
    render(<TaskCard task={task} />);
    const button = screen.getByRole("button");
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.keyboard("{Enter}");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard(" ");
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("fills the open panel from renderDetail, and only while open", async () => {
    const user = userEvent.setup();
    const renderDetail = vi.fn(() => <p>attempts and timeline go here</p>);
    render(<TaskCard task={task} renderDetail={renderDetail} />);
    expect(renderDetail).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button"));
    expect(renderDetail).toHaveBeenCalledWith({ kind: "task", taskId: "T4" });
    expect(screen.getByRole("region").textContent).toContain("attempts and timeline go here");
    await user.click(screen.getByRole("button"));
    expect(screen.queryByText("attempts and timeline go here")).toBeNull();
  });

  it("renders agent text as text, never as markup", () => {
    const { container } = render(<TaskCard task={{ ...task, title: "<img src=x onerror=alert(1)>" }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  });
});

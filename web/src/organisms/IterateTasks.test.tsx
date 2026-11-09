import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IterateTasks } from "./IterateTasks";

const tasks = [
  { taskId: "T1", title: "Create prueba.md", branch: "docs/one" },
  { taskId: "T2", title: "Document it", branch: "docs/two" },
];

describe("IterateTasks", () => {
  it("lists the delivered tasks with their title and branch, and marks the chosen one", () => {
    render(<IterateTasks tasks={tasks} selected="T2" onSelect={() => {}} />);
    const list = within(screen.getByRole("list", { name: "Tasks to iterate on" }));
    expect(list.getAllByRole("button")).toHaveLength(2);
    expect(list.getByRole("button", { name: /T1/ }).getAttribute("aria-pressed")).toBe("false");
    expect(list.getByRole("button", { name: /T2/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("docs/one")).toBeTruthy();
    expect(screen.getByText("Create prueba.md")).toBeTruthy();
  });

  it("chooses a task on click, and goes back to none when the chosen one is clicked again", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<IterateTasks tasks={tasks} selected={undefined} onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: /T1/ }));
    expect(onSelect).toHaveBeenLastCalledWith("T1");
    rerender(<IterateTasks tasks={tasks} selected="T1" onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: /T1/ }));
    expect(onSelect).toHaveBeenLastCalledWith(undefined);
  });

  it("renders nothing when there are no tasks", () => {
    const { container } = render(<IterateTasks tasks={[]} selected={undefined} onSelect={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});

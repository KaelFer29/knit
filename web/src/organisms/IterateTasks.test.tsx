import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IterateTasks, ITERATE_PAGE_SIZE } from "./IterateTasks";

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

  it("pages the tasks, a few at a time, so the list never covers the conversation", async () => {
    const many = Array.from({ length: ITERATE_PAGE_SIZE + 2 }, (_, i) => ({ taskId: `T${i + 1}`, title: `Task ${i + 1}`, branch: `docs/${i + 1}` }));
    const user = userEvent.setup();
    render(<IterateTasks tasks={many} selected={undefined} onSelect={() => {}} />);
    const list = within(screen.getByRole("list", { name: "Tasks to iterate on" }));
    expect(list.getAllByRole("button")).toHaveLength(ITERATE_PAGE_SIZE);
    expect(screen.getByText(`1–${ITERATE_PAGE_SIZE} of ${many.length} tasks`)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(list.getAllByRole("button")).toHaveLength(2);
    expect(list.getByRole("button", { name: /T6/ })).toBeTruthy();
  });

  it("shows no pager when everything fits in one page", () => {
    render(<IterateTasks tasks={tasks} selected={undefined} onSelect={() => {}} />);
    expect(screen.queryByRole("navigation", { name: /Pages of tasks/ })).toBeNull();
  });

  it("renders nothing when there are no tasks", () => {
    const { container } = render(<IterateTasks tasks={[]} selected={undefined} onSelect={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("says on the chosen row that its corrections go to the orchestrator", () => {
    render(<IterateTasks tasks={tasks} selected="T1" onSelect={() => {}} />);
    expect(within(screen.getByRole("button", { name: /T1/ })).getByText(/orchestrator/i)).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /T2/ })).queryByText(/orchestrator/i)).toBeNull();
  });
});


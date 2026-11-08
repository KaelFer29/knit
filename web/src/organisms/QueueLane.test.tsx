import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { TaskCardData } from "../molecules/TaskCard";
import { QueueLane } from "./QueueLane";

const card = (n: number, extra: Partial<TaskCardData> = {}): TaskCardData => ({ taskId: `T${n}`, title: `Task ${n}`, position: n, state: "queued", attempts: 0, ...extra });

describe("QueueLane", () => {
  it("lists the queued tasks in execution order", () => {
    render(<QueueLane items={[card(4, { dependsOn: "T3" }), card(5, { dependsOn: "T4" }), card(6)]} />);
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([expect.stringContaining("Task 4"), expect.stringContaining("Task 5"), expect.stringContaining("Task 6")]);
    expect(screen.getByRole("region", { name: /queue/i }).textContent).toContain("3");
  });

  it("draws a connector between a task and the one it depends on when they are neighbours", () => {
    const { container } = render(<QueueLane items={[card(4), card(5, { dependsOn: "T4" }), card(6, { dependsOn: "T1" }), card(7)]} />);
    const connectors = container.querySelectorAll("[data-connector]");
    expect(connectors).toHaveLength(1);
    // Placed between the cards of T4 and T5.
    expect(connectors[0]?.previousElementSibling?.textContent).toContain("Task 4");
    expect(connectors[0]?.nextElementSibling?.textContent).toContain("Task 5");
    // The dependency of T6 is not adjacent, so it only shows in its card.
    expect(screen.getByText("Task 6").closest("li")?.textContent).toContain("Depends on T1");
  });

  it("shows an empty state", () => {
    render(<QueueLane items={[]} />);
    expect(screen.getByText(/nothing waiting/i)).toBeTruthy();
  });

  it("folds a long queue behind a button that says how many are hidden", async () => {
    const user = userEvent.setup();
    render(<QueueLane items={Array.from({ length: 9 }, (_, i) => card(i + 2))} limit={5} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    const more = screen.getByRole("button", { name: /show 4 more/i });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await user.click(more);
    expect(screen.getAllByRole("listitem")).toHaveLength(9);
    expect(screen.getByRole("button", { name: /show fewer/i }).getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps each card a disclosure and passes the detail slot on", async () => {
    const user = userEvent.setup();
    render(<QueueLane items={[card(4)]} renderDetail={(t) => <p>detail of {t.kind === "task" ? t.taskId : "?"}</p>} />);
    await user.click(screen.getByRole("button", { name: /task 4/i }));
    expect(screen.getByText("detail of T4")).toBeTruthy();
  });
});

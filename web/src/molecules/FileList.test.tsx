import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FileList } from "./FileList";

describe("FileList", () => {
  it("lists each path as text, under its label", () => {
    render(<FileList label="Files touched" paths={["src/a.ts", "<img src=x onerror=alert(1)>.md"]} empty="No files" />);
    const list = screen.getByRole("list", { name: "Files touched" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["src/a.ts", "<img src=x onerror=alert(1)>.md"]);
    expect(list.querySelector("img")).toBeNull();
  });

  it("says so when there are no files", () => {
    render(<FileList label="Files touched" paths={[]} empty="No files touched yet." />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("No files touched yet.")).toBeTruthy();
  });

  it("says that more files changed than it lists", () => {
    render(<FileList label="Worktree" paths={["a.ts"]} moreFiles empty="Nothing" />);
    expect(screen.getByText("More files changed than shown.")).toBeTruthy();
  });

  it("shows the list when only more files are reported", () => {
    render(<FileList label="Worktree" paths={[]} moreFiles empty="Nothing" />);
    expect(screen.getByText("More files changed than shown.")).toBeTruthy();
    expect(screen.queryByText("Nothing")).toBeNull();
  });
});

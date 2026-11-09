import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { paginate } from "../lists/paginate";
import { ListToolbar } from "./ListToolbar";
import { Pager } from "./Pager";

const page = (n: number) => paginate(Array.from({ length: 23 }, (_, i) => i), n, 10);

describe("Pager", () => {
  it("says which items are shown and moves between pages", () => {
    const onPage = vi.fn();
    render(<Pager page={page(2)} onPage={onPage} noun="runs" />);
    expect(screen.getByText("11–20 of 23 runs")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onPage).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPage).toHaveBeenLastCalledWith(3);
  });

  it("disables the buttons at both ends", () => {
    const { rerender } = render(<Pager page={page(1)} onPage={() => {}} noun="runs" />);
    expect((screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<Pager page={page(3)} onPage={() => {}} noun="runs" />);
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders nothing when everything fits in one page", () => {
    const { container } = render(<Pager page={paginate([1, 2], 1, 10)} onPage={() => {}} noun="runs" />);
    expect(container.firstChild).toBeNull();
  });
});

describe("ListToolbar", () => {
  it("reports what is typed and shows how many items match", () => {
    const onQuery = vi.fn();
    render(<ListToolbar label="Search runs" query="" onQuery={onQuery} summary="3 of 9 runs" />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search runs" }), { target: { value: "login" } });
    expect(onQuery).toHaveBeenCalledWith("login");
    expect(screen.getByText("3 of 9 runs")).toBeTruthy();
  });

  it("renders the extra filters it is given", () => {
    render(
      <ListToolbar label="Search" query="" onQuery={() => {}}>
        <button type="button">Failed</button>
      </ListToolbar>,
    );
    expect(screen.getByRole("button", { name: "Failed" })).toBeTruthy();
  });
});

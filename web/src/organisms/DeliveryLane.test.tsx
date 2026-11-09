import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DeliveryItem } from "@board";
import { DeliveryLane } from "./DeliveryLane";

const item = (n: number, extra: Partial<DeliveryItem> = {}): DeliveryItem => ({
  taskId: `T${n}`,
  title: `Task ${n}`,
  position: n,
  commitSha: "3a1f9c2e8b7d1111",
  prUrl: `https://github.com/acme/shop/pull/${40 + n}`,
  ...extra,
});

describe("DeliveryLane", () => {
  it("shows a commit chip and a pull request chip per delivered task, in order", () => {
    render(<DeliveryLane items={[item(1), item(2, { commitSha: "9c41e07aaaa" })]} />);
    expect(screen.getByRole("region", { name: /delivered/i })).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("T1");
    expect(items[0]?.textContent).toContain("3a1f9c2");
    expect(items[1]?.textContent).toContain("9c41e07");
    expect(screen.getByRole("link", { name: /PR #41/ }).getAttribute("href")).toBe("https://github.com/acme/shop/pull/41");
    expect(screen.getByRole("link", { name: /PR #42/ })).toBeTruthy();
  });

  it("opens pull requests in a new tab without leaking the opener", () => {
    render(<DeliveryLane items={[item(1)]} />);
    const link = screen.getByRole("link", { name: /PR #41/ });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("draws no link when the task has no pull request or the URL is not http(s)", () => {
    render(<DeliveryLane items={[item(1, { prUrl: undefined }), item(2, { prUrl: "javascript:alert(1)" })]} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows an empty state", () => {
    render(<DeliveryLane items={[]} />);
    expect(screen.getByText(/delivered tasks will appear/i)).toBeTruthy();
  });
});

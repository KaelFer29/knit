import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import * as api from "./config/api";

vi.mock("./config/api");

beforeEach(() => {
  window.location.hash = "";
  vi.mocked(api.listConfigFiles).mockResolvedValue([]);
});

describe("navigation to the configuration editor", () => {
  it("switches to the configuration editor and back, keeping the URL in sync", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole("link", { name: "Runs" }).getAttribute("aria-current")).toBe("page");
    await user.click(screen.getByRole("link", { name: "Configuration" }));
    expect(window.location.hash).toBe("#/config");
    expect(await screen.findByText(/pick a file to edit/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Configuration" }).getAttribute("aria-current")).toBe("page");
    await user.click(screen.getByRole("link", { name: "Runs" }));
    expect(window.location.hash).toBe("#/runs");
    expect(screen.queryByText(/pick a file to edit/i)).toBeNull();
  });

  it("opens the configuration editor straight from the URL", async () => {
    window.location.hash = "#/config";
    render(<App />);
    expect(await screen.findByText(/pick a file to edit/i)).toBeTruthy();
  });
});

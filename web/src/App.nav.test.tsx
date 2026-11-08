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

describe("view tabs", () => {
  it("shows the flow first and switches to the configuration editor and back, keeping the URL in sync", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole("button", { name: "Flow" }).getAttribute("aria-current")).toBe("page");
    await user.click(screen.getByRole("button", { name: "Configuration" }));
    expect(window.location.hash).toBe("#/config");
    expect(screen.getByRole("button", { name: "Configuration" }).getAttribute("aria-current")).toBe("page");
    expect(await screen.findByText(/pick a file to edit/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Flow" }));
    expect(window.location.hash).toBe("");
    expect(screen.queryByText(/pick a file to edit/i)).toBeNull();
  });

  it("opens the configuration editor straight from the URL", async () => {
    window.location.hash = "#/config";
    render(<App />);
    expect(await screen.findByText(/pick a file to edit/i)).toBeTruthy();
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { FilesApi } from "../files/api";
import { demoFilesApi } from "../files/demo";
import { FilesView } from "./FilesView";

describe("FilesView", () => {
  it("shows the first root's top level, directories first", async () => {
    render(<FilesView api={demoFilesApi()} />);
    await screen.findByRole("treeitem", { name: /README.md/ });
    const names = screen.getAllByRole("treeitem").map((n) => n.textContent);
    expect(names[0]).toContain("src");
    expect(names[1]).toContain("docs");
  });

  it("expands a directory on demand and collapses it again", async () => {
    const user = userEvent.setup();
    render(<FilesView api={demoFilesApi()} />);
    await user.click(await screen.findByRole("treeitem", { name: /^src/ }));
    const child = await screen.findByRole("treeitem", { name: /index.ts/ });
    expect(child.getAttribute("aria-level")).toBe("2");
    expect(screen.getByRole("treeitem", { name: /^src/ }).getAttribute("aria-expanded")).toBe("true");
    await user.click(screen.getByRole("treeitem", { name: /^src/ }));
    expect(screen.queryByRole("treeitem", { name: /index.ts/ })).toBeNull();
  });

  it("opens a file and renders its content as text", async () => {
    const user = userEvent.setup();
    const api = demoFilesApi();
    api.read = async (_r, path) => ({ kind: "text", path, size: 30, text: "<img src=x onerror=alert(1)>" });
    render(<FilesView api={api} />);
    await user.click(await screen.findByRole("treeitem", { name: /README.md/ }));
    const code = await screen.findByLabelText("Contents of README.md");
    expect(code.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(code.querySelector("img")).toBeNull();
  });

  it("does not show binary content", async () => {
    const user = userEvent.setup();
    render(<FilesView api={demoFilesApi()} />);
    await user.click(await screen.findByRole("treeitem", { name: /logo.png/ }));
    expect(await screen.findByText(/binary file, not shown/i)).toBeTruthy();
  });

  it("explains an oversized file", async () => {
    const user = userEvent.setup();
    const api = demoFilesApi();
    api.read = async (_r, path) => ({ kind: "too-large", path, size: 2_000_000, limit: 524_288 });
    render(<FilesView api={api} />);
    await user.click(await screen.findByRole("treeitem", { name: /README.md/ }));
    expect(await screen.findByText(/too large to show \(limit 512.0 KB\)/i)).toBeTruthy();
  });

  it("reloads the tree when the root changes", async () => {
    const user = userEvent.setup();
    render(<FilesView api={demoFilesApi()} />);
    await screen.findByRole("treeitem", { name: /README.md/ });
    await user.selectOptions(screen.getByRole("combobox"), "T1");
    await screen.findByRole("treeitem", { name: /NOTES.md/ });
    expect(screen.queryByRole("treeitem", { name: /README.md/ })).toBeNull();
  });

  it("shows an error when a directory cannot be read", async () => {
    const api: FilesApi = { ...demoFilesApi(), list: async () => Promise.reject(new Error("Path is outside the root")) };
    render(<FilesView api={api} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Path is outside the root"));
  });
});

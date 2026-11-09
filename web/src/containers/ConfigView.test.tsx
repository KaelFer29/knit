import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as api from "../config/api";
import type { ConfigFileEntry } from "../config/api";
import { ConfigView } from "./ConfigView";

vi.mock("../config/api");

const entry = (over: Partial<ConfigFileEntry>): ConfigFileEntry => ({
  id: "claude:project:claude-md",
  agent: "claude",
  scope: "project",
  label: "CLAUDE.md",
  displayPath: "CLAUDE.md",
  isRule: false,
  exists: true,
  ...over,
});

const FILES: ConfigFileEntry[] = [
  entry({}),
  entry({ id: "claude:global:settings", scope: "global", label: "settings.json", displayPath: "~/.claude/settings.json" }),
  entry({ id: "cursor:project:rules/ui.mdc", agent: "cursor", label: "ui.mdc", displayPath: ".cursor/rules/ui.mdc", isRule: true }),
  entry({ id: "cursor:project:mcp", agent: "cursor", label: "mcp.json", displayPath: ".cursor/mcp.json", exists: false }),
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listConfigFiles).mockResolvedValue(FILES);
  vi.mocked(api.readConfigFile).mockImplementation(async (id) => ({
    id,
    exists: id !== "cursor:project:mcp",
    content: id === "claude:global:settings" ? '{"a":1}' : "line one\nline two",
    hash: `hash-of-${id}`,
    json: id.endsWith("settings") || id.endsWith("mcp"),
  }));
});

async function open(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  render(<ConfigView />);
  await user.click(await screen.findByRole("button", { name }));
  return screen.findByRole("textbox", { name: /contents of/i });
}

describe("config view", () => {
  it("lists the files by agent and scope, marking the ones that do not exist yet", async () => {
    render(<ConfigView />);
    const nav = await screen.findByRole("navigation", { name: /configuration files/i });
    expect(within(nav).getByText("Claude")).toBeTruthy();
    expect(within(nav).getByText("Cursor")).toBeTruthy();
    expect(within(nav).getAllByText(/^project$/i).length).toBeGreaterThan(0);
    expect(within(nav).getByRole("button", { name: /mcp\.json/ }).textContent).toMatch(/new/i);
  });

  it("loads the selected file into the editor", async () => {
    const user = userEvent.setup();
    const box = (await open(user, /CLAUDE\.md/)) as HTMLTextAreaElement;
    expect(box.value).toBe("line one\nline two");
    expect(api.readConfigFile).toHaveBeenCalledWith("claude:project:claude-md");
  });

  it("only offers a review once something changed", async () => {
    const user = userEvent.setup();
    const box = await open(user, /CLAUDE\.md/);
    expect((screen.getByRole("button", { name: /review changes/i }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(box, "!");
    expect((screen.getByRole("button", { name: /review changes/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the diff before saving, and saves with the hash it read, then reports the backup", async () => {
    vi.mocked(api.saveConfigFile).mockResolvedValue({ hash: "new-hash", backupPath: "/data/config-backups/x.bak" });
    const user = userEvent.setup();
    const box = await open(user, /CLAUDE\.md/);
    expect(screen.queryByRole("button", { name: /^save/i })).toBeNull();
    await user.clear(box);
    await user.type(box, "line one\nline 2");
    await user.click(screen.getByRole("button", { name: /review changes/i }));

    const diff = screen.getByRole("region", { name: /changes/i });
    expect(within(diff).getByText("line two").closest("[data-kind]")?.getAttribute("data-kind")).toBe("del");
    expect(within(diff).getByText("line 2").closest("[data-kind]")?.getAttribute("data-kind")).toBe("add");
    expect(api.saveConfigFile).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^save/i }));
    expect(api.saveConfigFile).toHaveBeenCalledWith("claude:project:claude-md", "line one\nline 2", "hash-of-claude:project:claude-md");
    expect((await screen.findByRole("status")).textContent).toContain("/data/config-backups/x.bak");
    expect(screen.queryByRole("region", { name: /changes/i })).toBeNull();
  });

  it("can go back from the review to keep editing", async () => {
    const user = userEvent.setup();
    const box = await open(user, /CLAUDE\.md/);
    await user.type(box, "x");
    await user.click(screen.getByRole("button", { name: /review changes/i }));
    await user.click(screen.getByRole("button", { name: /keep editing/i }));
    expect((screen.getByRole("textbox", { name: /contents of/i }) as HTMLTextAreaElement).value).toBe("line one\nline twox");
  });

  it("blocks the review of invalid JSON and says why", async () => {
    const user = userEvent.setup();
    const box = await open(user, /settings\.json/);
    await user.type(box, "{{");
    expect((screen.getByRole("button", { name: /review changes/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/valid JSON/i);
  });

  it("explains a conflict and reloads the file on request, keeping nothing stale", async () => {
    vi.mocked(api.saveConfigFile).mockRejectedValue(new ApiError(409, "The file changed since it was read."));
    const user = userEvent.setup();
    const box = await open(user, /CLAUDE\.md/);
    await user.type(box, "x");
    await user.click(screen.getByRole("button", { name: /review changes/i }));
    await user.click(screen.getByRole("button", { name: /^save/i }));
    expect((await screen.findByRole("alert")).textContent).toContain("changed since");
    vi.mocked(api.readConfigFile).mockResolvedValue({ id: "claude:project:claude-md", exists: true, content: "fresh", hash: "h2", json: false });
    await user.click(screen.getByRole("button", { name: /reload/i }));
    await waitFor(() => expect((screen.getByRole("textbox", { name: /contents of/i }) as HTMLTextAreaElement).value).toBe("fresh"));
  });

  it("shows a load failure instead of an empty editor", async () => {
    vi.mocked(api.listConfigFiles).mockRejectedValue(new ApiError(503, "The configuration editor is not available on this server"));
    render(<ConfigView />);
    expect((await screen.findByRole("alert")).textContent).toContain("not available");
  });
});

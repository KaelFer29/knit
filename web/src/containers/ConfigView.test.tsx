import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

// jsdom has no layout: CodeMirror measures text through Range rects, so give it empty ones.
beforeAll(async () => {
  const empty = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => empty as DOMRect;
  await import("../config/CodeEditor"); // the editor is lazy: load it once, outside any test timeout
}, 60_000);

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

const editorEl = (): HTMLElement => screen.getByRole("textbox", { name: /contents of/i });
const viewOf = (el: HTMLElement): EditorView => {
  const view = EditorView.findFromDOM(el.closest<HTMLElement>(".cm-editor")!);
  if (!view) throw new Error("no editor view");
  return view;
};
const textOf = (el: HTMLElement): string => viewOf(el).state.doc.toString();
/** Types through the editor state the way the browser input does, so edits group for undo like typed text. */
const typeInto = (el: HTMLElement, insert: string, replaceAll = false): void => {
  const view = viewOf(el);
  act(() => {
    view.dispatch({ changes: { from: replaceAll ? 0 : view.state.doc.length, to: view.state.doc.length, insert }, userEvent: "input.type" });
  });
};

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
    const field = await open(user, /CLAUDE\.md/);
    expect(textOf(field)).toBe("line one\nline two");
    expect(api.readConfigFile).toHaveBeenCalledWith("claude:project:claude-md");
  });

  it("only offers a review once something changed", async () => {
    const user = userEvent.setup();
    const box = await open(user, /CLAUDE\.md/);
    expect((screen.getByRole("button", { name: /review changes/i }) as HTMLButtonElement).disabled).toBe(true);
    typeInto(box, "!");
    expect((screen.getByRole("button", { name: /review changes/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the diff before saving, and saves with the hash it read, then reports the backup", async () => {
    vi.mocked(api.saveConfigFile).mockResolvedValue({ hash: "new-hash", backupPath: "/data/config-backups/x.bak" });
    const user = userEvent.setup();
    const box = await open(user, /CLAUDE\.md/);
    expect(screen.queryByRole("button", { name: /^save/i })).toBeNull();
    typeInto(box, "line one\nline 2", true);
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
    typeInto(box, "x");
    await user.click(screen.getByRole("button", { name: /review changes/i }));
    await user.click(screen.getByRole("button", { name: /keep editing/i }));
    expect(textOf(screen.getByRole("textbox", { name: /contents of/i }))).toBe("line one\nline twox");
  });

  it("blocks the review of invalid JSON and says why", async () => {
    const user = userEvent.setup();
    const box = await open(user, /settings\.json/);
    typeInto(box, "{");
    expect((screen.getByRole("button", { name: /review changes/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/valid JSON/i);
  });

  it("explains a conflict and reloads the file on request, keeping nothing stale", async () => {
    vi.mocked(api.saveConfigFile).mockRejectedValue(new ApiError(409, "The file changed since it was read."));
    const user = userEvent.setup();
    const box = await open(user, /CLAUDE\.md/);
    typeInto(box, "x");
    await user.click(screen.getByRole("button", { name: /review changes/i }));
    await user.click(screen.getByRole("button", { name: /^save/i }));
    expect((await screen.findByRole("alert")).textContent).toContain("changed since");
    vi.mocked(api.readConfigFile).mockResolvedValue({ id: "claude:project:claude-md", exists: true, content: "fresh", hash: "h2", json: false });
    await user.click(screen.getByRole("button", { name: /reload/i }));
    await waitFor(() => expect(textOf(editorEl())).toBe("fresh"));
  });

  it("shows a load failure instead of an empty editor", async () => {
    vi.mocked(api.listConfigFiles).mockRejectedValue(new ApiError(503, "The configuration editor is not available on this server"));
    render(<ConfigView />);
    expect((await screen.findByRole("alert")).textContent).toContain("not available");
  });

  it("shows the file that was clicked last even when an earlier read answers later, and never shows old content under a new name", async () => {
    const user = userEvent.setup();
    const pending = new Map<string, (c: api.ConfigFileContent) => void>();
    vi.mocked(api.readConfigFile).mockImplementation(
      (id) =>
        new Promise((resolve) => {
          pending.set(id, resolve);
        }),
    );
    render(<ConfigView />);
    await user.click(await screen.findByRole("button", { name: /^CLAUDE\.md/ }));
    await user.click(await screen.findByRole("button", { name: /ui\.mdc/ }));
    const content = (id: string, text: string): api.ConfigFileContent => ({ id, exists: true, content: text, hash: `h-${id}`, json: false });
    pending.get("cursor:project:rules/ui.mdc")!(content("cursor:project:rules/ui.mdc", "ui rules"));
    expect(textOf(await screen.findByRole("textbox", { name: /contents of/i }))).toBe("ui rules");
    await act(async () => {
      pending.get("claude:project:claude-md")!(content("claude:project:claude-md", "claude notes"));
    });
    expect(textOf(editorEl())).toBe("ui rules");
  });

  it("does not show the previous file's text while the next file is loading", async () => {
    const user = userEvent.setup();
    const field2 = await open(user, /^CLAUDE\.md/);
    expect(textOf(field2)).toBe("line one\nline two");
    vi.mocked(api.readConfigFile).mockImplementation(() => new Promise(() => {}));
    await user.click(screen.getByRole("button", { name: /ui\.mdc/ }));
    expect(screen.queryByRole("textbox", { name: /contents of/i })).toBeNull();
  });

  it("keeps one editor and its undo history across a round trip to the review", async () => {
    const user = userEvent.setup();
    const field = await open(user, /CLAUDE\.md/);
    const view = viewOf(field);
    typeInto(field, " one");
    await user.click(screen.getByRole("button", { name: /review changes/i }));
    expect(screen.getByRole("region", { name: /changes/i })).toBeTruthy();
    expect(viewOf(editorEl())).toBe(view);
    expect(view.state.readOnly).toBe(true);
    await user.click(screen.getByRole("button", { name: /keep editing/i }));
    expect(viewOf(editorEl())).toBe(view);
    expect(view.state.readOnly).toBe(false);
    expect(textOf(editorEl())).toBe("line one\nline two one");
    act(() => {
      undo(view);
    });
    expect(textOf(editorEl())).toBe("line one\nline two");
    expect((screen.getByRole("button", { name: /review changes/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("undoes with Ctrl+Z from the keyboard", async () => {
    const user = userEvent.setup();
    const field = await open(user, /CLAUDE\.md/);
    typeInto(field, "!");
    field.focus();
    await user.keyboard("{Control>}z{/Control}");
    expect(textOf(field)).toBe("line one\nline two");
  });

  it("starts a fresh history for another file", async () => {
    const user = userEvent.setup();
    const field = await open(user, /^CLAUDE\.md/);
    typeInto(field, "!");
    await user.click(screen.getByRole("button", { name: /ui\.mdc/ }));
    await screen.findByRole("textbox", { name: /contents of/i });
    act(() => {
      undo(viewOf(editorEl()));
    });
    expect(textOf(editorEl())).toBe("line one\nline two");
  });
});

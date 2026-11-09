import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDraftCache } from "../../../branches/draftCache";
import { BranchesView } from "./BranchesView";

const ok = { ok: true as const, effects: ["Adds one commit to docs/one that restores the code."] };
const refuse = (reason: string) => ({ ok: false as const, reason });

const branch = (over: Record<string, unknown> = {}) => ({
  taskId: "T1",
  title: "Create prueba.md",
  status: "passed",
  branch: "docs/one",
  startSha: "aaaaaaa",
  state: { exists: true, head: "bbbbbbb", historyIntact: true, pushed: false, hasWorktree: true, dirty: false, ahead: [{ sha: "b1", subject: "docs: add prueba.md" }] },
  undo: { revert: ok, reset: { ok: true, effects: ["Moves docs/one back to the commit the task started from. 1 commit leaves the branch."] }, delete: { ok: true, effects: ["Deletes the branch docs/one and its worktree.", "1 commit of the task is lost from this repository."] } },
  pr: { ok: true, base: "main", head: "docs/one", effects: ["Pushes docs/one to origin, without forcing.", "Opens a pull request from docs/one into main."] },
  ...over,
});

interface Call {
  method: string;
  url: string;
  body?: unknown;
}
let calls: Call[];
let listing: { branches: unknown[] };
let replies: Record<string, { status: number; body: unknown }>;

beforeEach(() => {
  window.sessionStorage.clear();
  resetDraftCache();
  calls = [];
  listing = { branches: [branch()] };
  replies = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: { method?: string; body?: string }) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url, ...(init?.body ? { body: JSON.parse(init.body) } : {}) });
      const forced = replies[`${method} ${url.replace(/^\/api\/runs\/run-1\/tasks\/T1\//, "")}`];
      const body = forced ? forced.body : url.endsWith("/branches") ? { runId: "run-1", runStatus: "passed", base: "main", ...listing } : {};
      return new Response(JSON.stringify(body), { status: forced?.status ?? 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const show = () => render(<BranchesView runId="run-1" pollMs={60_000} />);
const posts = (): Call[] => calls.filter((c) => c.method === "POST");

describe("BranchesView", () => {
  it("shows each branch with its commits, where it is and what it can do", async () => {
    show();
    const card = await screen.findByRole("region", { name: "Branch docs/one" });
    expect(within(card).getByText("T1")).toBeTruthy();
    expect(within(card).getByText("docs/one")).toBeTruthy();
    expect(within(card).queryByText("Create prueba.md")).toBeNull();
    expect(within(card).getByText("1 commit")).toBeTruthy();
    expect(within(card).getByText("Local only")).toBeTruthy();
    expect(within(card).getByText("docs: add prueba.md")).toBeTruthy();
    expect((within(card).getByRole("button", { name: "Open pull request" }) as HTMLButtonElement).disabled).toBe(false);
  });

  describe("with many branches", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => branch({ taskId: `T${i + 1}`, title: `Task number ${i + 1}`, branch: `feat/b${i + 1}` }));

    it("shows each as one collapsed row and opens its commits and actions on demand", async () => {
      listing = { branches: many(3) };
      const user = userEvent.setup();
      show();
      const row = await screen.findByRole("region", { name: "Branch feat/b2" });
      expect(within(row).getByText("feat/b2")).toBeTruthy();
      expect(within(row).queryByText("1 commit")).toBeNull();
      expect(within(row).queryByText("docs: add prueba.md")).toBeNull();
      expect(within(row).queryByRole("button", { name: "Open pull request" })).toBeNull();
      const toggle = within(row).getByRole("button", { name: /T2/ });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      await user.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(within(row).getByText("docs: add prueba.md")).toBeTruthy();
      expect(within(row).getByText("1 commit")).toBeTruthy();
      expect(within(row).getByText("Local only")).toBeTruthy();
      expect(within(row).getByText("Has a worktree")).toBeTruthy();
      expect(within(row).getByRole("button", { name: "Open pull request" })).toBeTruthy();
      await user.click(toggle);
      expect(within(row).queryByText("docs: add prueba.md")).toBeNull();
    });

    it("opens a lone branch by itself, since there is nothing to scan", async () => {
      show();
      expect(await screen.findByText("docs: add prueba.md")).toBeTruthy();
    });

    it("shows one page of branches and moves through the rest", async () => {
      listing = { branches: many(8) };
      const user = userEvent.setup();
      show();
      expect(await screen.findAllByRole("region", { name: /^Branch / })).toHaveLength(6);
      expect(screen.getByText("1–6 of 8 branches")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Next page" }));
      expect(screen.getAllByRole("region", { name: /^Branch / })).toHaveLength(2);
    });

    it("searches by task, title or branch name", async () => {
      listing = { branches: many(8) };
      const user = userEvent.setup();
      show();
      await screen.findAllByRole("region", { name: /^Branch / });
      await user.type(screen.getByRole("searchbox", { name: "Search branches" }), "b7");
      expect(screen.getAllByRole("region", { name: /^Branch / })).toHaveLength(1);
      expect(screen.getByRole("region", { name: "Branch feat/b7" })).toBeTruthy();
      await user.clear(screen.getByRole("searchbox", { name: "Search branches" }));
      await user.type(screen.getByRole("searchbox", { name: "Search branches" }), "zzz");
      expect(screen.getByText("No branch matches this search.")).toBeTruthy();
    });
  });

  it("does not repeat the branch name below the row, and has no note about where pull requests go", async () => {
    show();
    const card = await screen.findByRole("region", { name: "Branch docs/one" });
    expect(within(card).getAllByText("docs/one")).toHaveLength(1);
    expect(screen.queryByText(/Nothing is pushed until you press the button/)).toBeNull();
  });

  it("says when there is nothing to show yet", async () => {
    listing = { branches: [] };
    show();
    expect(await screen.findByText(/no branches yet/i)).toBeTruthy();
  });

  it("shows the pull request a branch has instead of offering another", async () => {
    listing = { branches: [branch({ prUrl: "https://example.test/pull/7", state: { ...branch().state, pushed: true }, pr: refuse("T1 already has a pull request: https://example.test/pull/7") })] };
    show();
    const link = await screen.findByRole("link", { name: /pull request/i });
    expect(link.getAttribute("href")).toBe("https://example.test/pull/7");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.queryByRole("button", { name: "Open pull request" })).toBeNull();
  });

  it("disables the pull request button with the reason when it cannot be opened", async () => {
    listing = { branches: [branch({ pr: refuse("T1 did not pass its checks. A pull request is only opened for work that passed.") })] };
    show();
    const button = (await screen.findByRole("button", { name: "Open pull request" })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/did not pass its checks/)).toBeTruthy();
  });

  describe("undo", () => {
    it("asks first, says exactly what it will do, and does nothing until it is confirmed", async () => {
      const user = userEvent.setup();
      show();
      await user.click(await screen.findByRole("button", { name: "Undo" }));
      await user.click(screen.getByRole("menuitem", { name: /Delete branch/ }));
      const confirm = screen.getByRole("alertdialog", { name: /Delete branch docs\/one/i });
      expect(within(confirm).getByText("Deletes the branch docs/one and its worktree.")).toBeTruthy();
      expect(within(confirm).getByText(/1 commit of the task is lost/)).toBeTruthy();
      expect(posts()).toEqual([]);
      await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(posts()).toEqual([]);
    });

    it("sends the confirmed mode, then shows the result and reads the branches again", async () => {
      const user = userEvent.setup();
      replies["POST undo"] = { status: 200, body: { ok: true, dryRun: false, mode: "revert", branch: "docs/one", effects: [], sha: "abc1234" } };
      show();
      await user.click(await screen.findByRole("button", { name: "Undo" }));
      await user.click(screen.getByRole("menuitem", { name: /Revert/ }));
      await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Revert the changes" }));
      await waitFor(() => expect(posts()).toEqual([{ method: "POST", url: "/api/runs/run-1/tasks/T1/undo", body: { mode: "revert", confirm: true } }]));
      expect(await screen.findByRole("status")).toBeTruthy();
      expect(screen.getByRole("status").textContent).toMatch(/reverted/i);
      await waitFor(() => expect(calls.filter((c) => c.url.endsWith("/branches")).length).toBeGreaterThan(1));
    });

    it("shows the server's reason when it refuses, and keeps the confirmation open", async () => {
      const user = userEvent.setup();
      replies["POST undo"] = { status: 409, body: { error: "The run is still running. Abort it first." } };
      show();
      await user.click(await screen.findByRole("button", { name: "Undo" }));
      await user.click(screen.getByRole("menuitem", { name: /Reset/ }));
      await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Move back to the start" }));
      expect((await screen.findByRole("alert")).textContent).toContain("still running");
      expect(screen.getByRole("alertdialog")).toBeTruthy();
    });

    it("greys out an undo that is not allowed and says why", async () => {
      const user = userEvent.setup();
      listing = { branches: [branch({ undo: { revert: ok, reset: refuse("T2 (docs/two) is stacked on docs/one. Undo it first."), delete: refuse("T2 (docs/two) is stacked on docs/one. Undo it first.") } })] };
      show();
      await user.click(await screen.findByRole("button", { name: "Undo" }));
      const del = screen.getByRole("menuitem", { name: /Delete branch/ });
      expect(del.getAttribute("aria-disabled")).toBe("true");
      expect(within(del).getByText(/stacked on docs\/one/)).toBeTruthy();
      await user.click(del);
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
  });

  describe("pull request", () => {
    it("has the cheap model write the text, lets it be edited, and opens only on the click", async () => {
      const user = userEvent.setup();
      replies["POST pr-draft"] = { status: 200, body: { ok: true, title: "Add prueba.md", body: "## Summary\n- adds it", model: "composer-2.5-fast" } };
      replies["POST pr"] = { status: 200, body: { ok: true, url: "https://example.test/pull/7", base: "main", head: "docs/one" } };
      show();
      await user.click(await screen.findByRole("button", { name: "Open pull request" }));
      const form = await screen.findByRole("form", { name: /pull request for docs\/one/i });
      expect(within(form).getByText(/composer-2\.5-fast/)).toBeTruthy();
      const title = await within(form).findByRole("textbox", { name: "Title" });
      await waitFor(() => expect((title as HTMLInputElement).value).toBe("Add prueba.md"));
      expect((within(form).getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).value).toBe("## Summary\n- adds it");
      expect(within(form).getByText("Pushes docs/one to origin, without forcing.")).toBeTruthy();
      expect(posts().map((p) => p.url)).toEqual(["/api/runs/run-1/tasks/T1/pr-draft"]);
      await user.clear(title);
      await user.type(title, "Create prueba.md");
      await user.click(within(form).getByRole("button", { name: "Push and open pull request" }));
      await waitFor(() => expect(posts().at(-1)).toEqual({ method: "POST", url: "/api/runs/run-1/tasks/T1/pr", body: { title: "Create prueba.md", body: "## Summary\n- adds it" } }));
      expect((await screen.findByRole("status")).textContent).toContain("https://example.test/pull/7");
    });

    it("shows that it is working while the model writes: a spinner, a busy form and fields that wait", async () => {
      const user = userEvent.setup();
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => (release = r));
      const original = globalThis.fetch;
      vi.stubGlobal("fetch", async (input: string, init?: { method?: string; body?: string }) => {
        if (String(input).endsWith("/pr-draft")) {
          calls.push({ method: "POST", url: String(input) });
          await gate;
          return new Response(JSON.stringify({ ok: true, title: "Add prueba.md", body: "text", model: "composer-2.5-fast" }), { status: 200 });
        }
        return original(input, init as RequestInit);
      });
      show();
      await user.click(await screen.findByRole("button", { name: "Open pull request" }));
      const form = await screen.findByRole("form", { name: /pull request for docs\/one/i });
      expect(form.getAttribute("aria-busy")).toBe("true");
      expect(within(form).getByRole("progressbar", { name: /writing the description/i })).toBeTruthy();
      expect((within(form).getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).disabled).toBe(true);
      expect((within(form).getByRole("button", { name: "Push and open pull request" }) as HTMLButtonElement).disabled).toBe(true);
      release();
      await waitFor(() => expect(form.getAttribute("aria-busy")).toBe("false"));
      expect(within(form).queryByRole("progressbar")).toBeNull();
      expect((within(form).getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).disabled).toBe(false);
    });

    it("does not pay twice when the form is closed and opened while the model is still writing", async () => {
      const user = userEvent.setup();
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => (release = r));
      const original = globalThis.fetch;
      let modelCalls = 0;
      vi.stubGlobal("fetch", async (input: string, init?: { method?: string; body?: string }) => {
        if (String(input).endsWith("/pr-draft")) {
          modelCalls += 1;
          await gate;
          return new Response(JSON.stringify({ ok: true, title: "Add prueba.md", body: "text", model: "composer-2.5-fast" }), { status: 200 });
        }
        return original(input, init as RequestInit);
      });
      show();
      await user.click(await screen.findByRole("button", { name: "Open pull request" }));
      await user.click(within(await screen.findByRole("form", { name: /pull request for docs\/one/i })).getByRole("button", { name: "Cancel" }));
      await user.click(screen.getByRole("button", { name: "Open pull request" }));
      release();
      const form = await screen.findByRole("form", { name: /pull request for docs\/one/i });
      await waitFor(() => expect((within(form).getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).value).toBe("text"));
      expect(modelCalls).toBe(1);
    });

    it("keeps the written text: closing the form and opening it again does not ask the model again", async () => {
      const user = userEvent.setup();
      replies["POST pr-draft"] = { status: 200, body: { ok: true, title: "Add prueba.md", body: "## Summary\n- adds it", model: "composer-2.5-fast" } };
      show();
      await user.click(await screen.findByRole("button", { name: "Open pull request" }));
      const form = await screen.findByRole("form", { name: /pull request for docs\/one/i });
      await waitFor(() => expect((within(form).getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Add prueba.md"));
      await user.click(within(form).getByRole("button", { name: "Cancel" }));
      await user.click(screen.getByRole("button", { name: "Open pull request" }));
      const again = await screen.findByRole("form", { name: /pull request for docs\/one/i });
      expect((within(again).getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Add prueba.md");
      expect((within(again).getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).value).toBe("## Summary\n- adds it");
      expect(within(again).getByText(/saved/i)).toBeTruthy();
      expect(posts().filter((p) => p.url.endsWith("pr-draft"))).toHaveLength(1);
    });

    it("keeps what the person edited, and keeps it after the whole view is closed and opened again", async () => {
      const user = userEvent.setup();
      replies["POST pr-draft"] = { status: 200, body: { ok: true, title: "Add prueba.md", body: "first", model: "composer-2.5-fast" } };
      const first = show();
      await user.click(await screen.findByRole("button", { name: "Open pull request" }));
      const form = await screen.findByRole("form", { name: /pull request for docs\/one/i });
      const body = within(form).getByRole("textbox", { name: "Description" });
      await waitFor(() => expect((body as HTMLTextAreaElement).value).toBe("first"));
      await user.clear(body);
      await user.type(body, "my own words");
      await user.click(within(form).getByRole("button", { name: "Cancel" }));
      first.unmount();
      show();
      await user.click(await screen.findByRole("button", { name: "Open pull request" }));
      const reopened = await screen.findByRole("form", { name: /pull request for docs\/one/i });
      expect((within(reopened).getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).value).toBe("my own words");
      expect(posts().filter((p) => p.url.endsWith("pr-draft"))).toHaveLength(1);
    });

    it("asks the model again on request, and when the branch has a new commit since the text was written", async () => {
      const user = userEvent.setup();
      replies["POST pr-draft"] = { status: 200, body: { ok: true, title: "Add prueba.md", body: "first", model: "composer-2.5-fast" } };
      const view = show();
      await user.click(await screen.findByRole("button", { name: "Open pull request" }));
      const form = await screen.findByRole("form", { name: /pull request for docs\/one/i });
      await waitFor(() => expect((within(form).getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).value).toBe("first"));
      replies["POST pr-draft"] = { status: 200, body: { ok: true, title: "Add prueba.md", body: "second", model: "composer-2.5-fast" } };
      await user.click(within(form).getByRole("button", { name: "Write it again" }));
      await waitFor(() => expect((within(form).getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).value).toBe("second"));
      expect(posts().filter((p) => p.url.endsWith("pr-draft"))).toHaveLength(2);
      view.unmount();
      listing = { branches: [branch({ state: { ...branch().state, head: "ccccccc" } })] };
      replies["POST pr-draft"] = { status: 200, body: { ok: true, title: "Add prueba.md", body: "third", model: "composer-2.5-fast" } };
      show();
      await user.click(await screen.findByRole("button", { name: "Open pull request" }));
      const fresh = await screen.findByRole("form", { name: /pull request for docs\/one/i });
      await waitFor(() => expect((within(fresh).getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).value).toBe("third"));
      expect(posts().filter((p) => p.url.endsWith("pr-draft"))).toHaveLength(3);
    });

    it("does not keep a failed draft: the next try asks the model", async () => {
      const user = userEvent.setup();
      replies["POST pr-draft"] = { status: 409, body: { error: "The model could not write the description: timed out" } };
      show();
      await user.click(await screen.findByRole("button", { name: "Open pull request" }));
      const form = await screen.findByRole("form", { name: /pull request for docs\/one/i });
      await within(form).findByRole("alert");
      await user.click(within(form).getByRole("button", { name: "Cancel" }));
      replies["POST pr-draft"] = { status: 200, body: { ok: true, title: "Add prueba.md", body: "now it works", model: "composer-2.5-fast" } };
      await user.click(screen.getByRole("button", { name: "Open pull request" }));
      const again = await screen.findByRole("form", { name: /pull request for docs\/one/i });
      await waitFor(() => expect((within(again).getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).value).toBe("now it works"));
      expect(posts().filter((p) => p.url.endsWith("pr-draft"))).toHaveLength(2);
    });

    it("still lets the person write it by hand when the model fails, with the task's title as a start", async () => {
      const user = userEvent.setup();
      replies["POST pr-draft"] = { status: 409, body: { error: "The model could not write the description: timed out" } };
      show();
      await user.click(await screen.findByRole("button", { name: "Open pull request" }));
      const form = await screen.findByRole("form", { name: /pull request for docs\/one/i });
      expect((await within(form).findByRole("alert")).textContent).toContain("timed out");
      expect((within(form).getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Create prueba.md");
      expect(within(form).getByRole("button", { name: "Push and open pull request" })).toBeTruthy();
    });

    it("cannot be sent without a title, and Cancel closes it without pushing anything", async () => {
      const user = userEvent.setup();
      replies["POST pr-draft"] = { status: 200, body: { ok: true, title: "", body: "", model: "composer-2.5-fast" } };
      show();
      await user.click(await screen.findByRole("button", { name: "Open pull request" }));
      const form = await screen.findByRole("form", { name: /pull request for docs\/one/i });
      const title = within(form).getByRole("textbox", { name: "Title" });
      await user.clear(title);
      expect((within(form).getByRole("button", { name: "Push and open pull request" }) as HTMLButtonElement).disabled).toBe(true);
      await user.click(within(form).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("form")).toBeNull();
      expect(posts().every((p) => p.url.endsWith("pr-draft"))).toBe(true);
    });

    it("shows why GitHub refused and keeps what was written", async () => {
      const user = userEvent.setup();
      replies["POST pr-draft"] = { status: 200, body: { ok: true, title: "Add prueba.md", body: "text", model: "composer-2.5-fast" } };
      replies["POST pr"] = { status: 409, body: { error: "GitHub CLI is not logged in. Run: gh auth login" } };
      show();
      await user.click(await screen.findByRole("button", { name: "Open pull request" }));
      const form = await screen.findByRole("form", { name: /pull request for docs\/one/i });
      await waitFor(() => expect((within(form).getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Add prueba.md"));
      await user.click(within(form).getByRole("button", { name: "Push and open pull request" }));
      expect((await within(form).findByRole("alert")).textContent).toContain("not logged in");
      expect((within(form).getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).value).toBe("text");
    });
  });
});

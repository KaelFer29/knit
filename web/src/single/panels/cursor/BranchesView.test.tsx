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
  checkout: { ok: true as const, effects: ["Removes the worktree of T1. The branch docs/one and its 1 commit stay.", "Switches your repository to docs/one, so you can test it there. Your repository must have no uncommitted changes.", "To iterate on T1 again, switch back first (git checkout main): a branch can only be checked out in one place."] },
  pr: { ok: true, base: "main", head: "docs/one", options: ["main", "docs/two"], effects: ["Pushes docs/one to origin, without forcing.", "Opens a pull request from docs/one into main."] },
  ...over,
});

interface Call {
  method: string;
  url: string;
  body?: unknown;
}
let calls: Call[];
let listing: { branches: unknown[]; returnTo?: { taskId: string; branch: string } };
let replies: Record<string, { status: number; body: unknown }>;
let remote: string[];

beforeEach(() => {
  window.sessionStorage.clear();
  resetDraftCache();
  calls = [];
  listing = { branches: [branch()] };
  replies = {};
  remote = ["docs/one", "docs/two", "main"];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: { method?: string; body?: string }) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url, ...(init?.body ? { body: JSON.parse(init.body) } : {}) });
      if (method === "GET" && url.endsWith("/remote-branches")) {
        const refused = replies["GET remote-branches"];
        return new Response(JSON.stringify(refused ? refused.body : { branches: remote }), { status: refused?.status ?? 200 });
      }
      const forced = replies[`${method} ${url.replace(/^\/api\/runs\/run-1\/tasks\/T1\//, "")}`];
      const body = forced ? forced.body : url.endsWith("/branches") ? { runId: "run-1", runStatus: "passed", base: "main", ...listing } : {};
      return new Response(JSON.stringify(body), { status: forced?.status ?? 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const show = (flashMs?: number) => render(<BranchesView runId="run-1" pollMs={60_000} {...(flashMs === undefined ? {} : { flashMs })} />);
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

  describe("test this branch", () => {
    const open = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(await screen.findByRole("button", { name: "Test this branch" }));
      return screen.getByRole("alertdialog", { name: /Test docs\/one in your repository/i });
    };

    it("asks first, says exactly what it will do, and does nothing until it is confirmed", async () => {
      const user = userEvent.setup();
      show();
      const dialog = await open(user);
      expect(within(dialog).getByText(/Removes the worktree of T1/)).toBeTruthy();
      expect(within(dialog).getByText(/git checkout main/)).toBeTruthy();
      expect(posts()).toEqual([]);
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(posts()).toEqual([]);
    });

    it("sends the confirmation and reads the branches again", async () => {
      const user = userEvent.setup();
      replies["POST checkout"] = { status: 200, body: { ok: true, dryRun: false, branch: "docs/one", effects: [], freedWorktree: true } };
      show();
      const dialog = await open(user);
      await user.click(within(dialog).getByRole("button", { name: "Switch my repository" }));
      await waitFor(() => expect(posts()).toEqual([{ method: "POST", url: "/api/runs/run-1/tasks/T1/checkout", body: { confirm: true } }]));
      await waitFor(() => expect(calls.filter((c) => c.url.endsWith("/branches")).length).toBeGreaterThan(1));
    });

    it("says it was done with a notice at the right end of the state tags, not a banner, and the notice goes away by itself", async () => {
      const user = userEvent.setup();
      replies["POST checkout"] = { status: 200, body: { ok: true, dryRun: false, branch: "docs/one", effects: [], freedWorktree: true } };
      show(400);
      const dialog = await open(user);
      await user.click(within(dialog).getByRole("button", { name: "Switch my repository" }));
      const tags = within(screen.getByRole("list", { name: "State of the branch" }));
      const notice = await tags.findByRole("status");
      expect(notice.textContent).toMatch(/Repository switched/);
      // The last tag, so it sits at the far right of the row.
      const items = tags.getAllByRole("listitem");
      expect(items.at(-1)!.contains(notice)).toBe(true);
      // No banner of its own.
      expect(screen.queryByText(/Your repository is now on/)).toBeNull();
      await waitFor(() => expect(tags.queryByRole("status")).toBeNull(), { timeout: 2000 });
    });

    it("shows why it was refused and keeps the confirmation open", async () => {
      const user = userEvent.setup();
      replies["POST checkout"] = { status: 409, body: { error: "Your repository has uncommitted changes. Commit or stash them first, so switching branches cannot touch them" } };
      show();
      const dialog = await open(user);
      await user.click(within(dialog).getByRole("button", { name: "Switch my repository" }));
      expect((await screen.findByRole("alert")).textContent).toContain("uncommitted changes");
      expect(screen.getByRole("alertdialog")).toBeTruthy();
    });

    it("offers to give the repository back its branch only on the task that was tested, and sends the confirmation", async () => {
      const user = userEvent.setup();
      listing = { branches: [branch({ taskId: "T1", branch: "docs/one" }), branch({ taskId: "T2", title: "Other", branch: "docs/two" })], returnTo: { taskId: "T1", branch: "main" } };
      replies["POST return"] = { status: 200, body: { ok: true, branch: "main" } };
      show();
      await user.click(await screen.findByRole("button", { name: /docs\/one/ }));
      const button = await screen.findByRole("button", { name: "Return repository to main" });
      expect(screen.queryByRole("region", { name: "Branch docs/two" })).toBeTruthy();
      await user.click(button);
      const dialog = screen.getByRole("alertdialog", { name: "Return your repository to main" });
      expect(within(dialog).getByText(/Switches your repository back to main/)).toBeTruthy();
      expect(posts()).toEqual([]);
      await user.click(within(dialog).getByRole("button", { name: "Switch back to main" }));
      await waitFor(() => expect(posts()).toEqual([{ method: "POST", url: "/api/runs/run-1/tasks/T1/return", body: { confirm: true } }]));
    });

    it("is disabled, with the reason, when the branch cannot be tested", async () => {
      listing = { branches: [branch({ checkout: refuse("Your repository is already on docs/one."), state: { ...branch().state, checkedOut: true, hasWorktree: false } })] };
      show();
      const button = (await screen.findByRole("button", { name: "Test this branch" })) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(screen.getByText("Your repository is already on docs/one.")).toBeTruthy();
    });
  });

  describe("pull request state", () => {
    const PR = "https://github.com/acme/demo/pull/7";

    it("shows a merged pull request in purple, and into which branch it was merged", async () => {
      listing = { branches: [branch({ prUrl: PR, prState: { state: "merged", base: "release/1.2" }, state: { ...branch().state, pushed: true } })] };
      show();
      const card = await screen.findByRole("region", { name: "Branch docs/one" });
      const pill = within(card).getByText("Merged into release/1.2");
      expect(pill.getAttribute("data-state")).toBe("merged");
      expect(within(card).getByRole("link", { name: "Merged ↗" }).getAttribute("href")).toBe(PR);
    });

    it("says how many commits came after a merged pull request, and offers to open another", async () => {
      listing = { branches: [branch({ prUrl: PR, prState: { state: "merged", base: "main", newCommits: 2 }, state: { ...branch().state, pushed: true } })] };
      show();
      const card = await screen.findByRole("region", { name: "Branch docs/one" });
      expect(within(card).getByText("Merged into main")).toBeTruthy();
      expect(within(card).getByText("2 new commits").getAttribute("data-state")).toBe("new");
      const button = within(card).getByRole("button", { name: "Open pull request" }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      expect(within(card).getByRole("link", { name: "Merged ↗" }).getAttribute("href")).toBe(PR);
    });

    it("speaks of one new commit in the singular, and says nothing when there are none", async () => {
      listing = { branches: [branch({ prUrl: PR, prState: { state: "merged", base: "main", newCommits: 1 }, state: { ...branch().state, pushed: true } })] };
      const first = show();
      expect(await screen.findByText("1 new commit")).toBeTruthy();
      first.unmount();
      listing = { branches: [branch({ prUrl: PR, prState: { state: "merged", base: "main", newCommits: 0 }, pr: refuse(`T1 already has a pull request: ${PR}`), state: { ...branch().state, pushed: true } })] };
      show();
      await screen.findByText("Merged into main");
      expect(screen.queryByText(/new commit/)).toBeNull();
      expect(screen.queryByRole("button", { name: "Open pull request" })).toBeNull();
    });

    it("says when a pull request was closed without merging, and when it is still open", async () => {
      listing = { branches: [branch({ prUrl: PR, prState: { state: "closed", base: "main" }, state: { ...branch().state, pushed: true } })] };
      const first = show();
      expect(await screen.findByText("Closed without merging")).toBeTruthy();
      expect(screen.getByRole("link", { name: "Closed ↗" })).toBeTruthy();
      first.unmount();
      listing = { branches: [branch({ prUrl: PR, prState: { state: "open", base: "main" }, state: { ...branch().state, pushed: true } })] };
      show();
      expect(await screen.findByRole("link", { name: "Pull request ↗" })).toBeTruthy();
      expect(screen.queryByText(/Merged into/)).toBeNull();
    });
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

  describe("where the pull request goes", () => {
    const open = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(await screen.findByRole("button", { name: "Open pull request" }));
      const form = await screen.findByRole("form", { name: /pull request for docs\/one/i });
      return form;
    };
    const into = (form: HTMLElement) => within(form).getByRole("combobox", { name: "Into branch" }) as HTMLSelectElement;
    const optionsOf = (select: HTMLSelectElement) => Array.from(select.options).map((o) => o.textContent);

    it("lists the branches origin has in a dropdown, the recommended one first and chosen, and never the branch itself", async () => {
      remote = ["docs/one", "docs/two", "main", "release/1.2"];
      const user = userEvent.setup();
      show();
      const form = await open(user);
      await waitFor(() => expect(optionsOf(into(form))).toEqual(["main (recommended)", "docs/two", "release/1.2"]));
      expect(into(form).value).toBe("main");
      expect(calls.some((c) => c.method === "GET" && c.url === "/api/runs/run-1/remote-branches")).toBe(true);
      await user.selectOptions(into(form), "docs/two");
      expect(within(form).getByText("Opens a pull request from docs/one into docs/two.")).toBeTruthy();
    });

    it("sends the branch only when it was changed, and keeps the old request when it was not", async () => {
      const user = userEvent.setup();
      replies["POST pr"] = { status: 200, body: { ok: true, url: "https://example.test/pull/7", base: "docs/two", head: "docs/one" } };
      replies["POST pr-draft"] = { status: 200, body: { ok: true, title: "Add prueba.md", body: "- adds it", model: "template" } };
      show();
      const form = await open(user);
      await within(form).findByDisplayValue("- adds it");
      await waitFor(() => expect(into(form).options.length).toBeGreaterThan(1));
      await user.selectOptions(into(form), "docs/two");
      await user.click(within(form).getByRole("button", { name: "Push and open pull request" }));
      await waitFor(() => expect(posts().find((c) => c.url.endsWith("/pr"))?.body).toEqual({ title: "Add prueba.md", body: "- adds it", base: "docs/two" }));
    });

    it("asks to choose when the recommended branch is not on origin, and cannot be sent until one is chosen", async () => {
      remote = ["docs/one", "release/1.2"];
      const user = userEvent.setup();
      show();
      const form = await open(user);
      await waitFor(() => expect(within(form).getByText(/main is not on origin/)).toBeTruthy());
      expect(into(form).value).toBe("");
      expect(optionsOf(into(form))).toEqual(["Choose a branch…", "release/1.2"]);
      expect((within(form).getByRole("button", { name: "Push and open pull request" }) as HTMLButtonElement).disabled).toBe(true);
      await user.selectOptions(into(form), "release/1.2");
      await waitFor(() => expect((within(form).getByRole("button", { name: "Push and open pull request" }) as HTMLButtonElement).disabled).toBe(false));
    });

    it("falls back to the suggested branches and says so when origin cannot be asked", async () => {
      replies["GET remote-branches"] = { status: 502, body: { error: "Could not ask origin which branches it has: no network" } };
      const user = userEvent.setup();
      show();
      const form = await open(user);
      await waitFor(() => expect(within(form).getByText(/no network/)).toBeTruthy());
      expect(optionsOf(into(form))).toEqual(["main (recommended)", "docs/two"]);
      expect(into(form).value).toBe("main");
    });
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
      // A short notice at the end of the tags, like the checkout one; the link is the row's "Pull request" tag.
      expect(await screen.findByText("Pull request opened")).toBeTruthy();
    });

    it("builds the description from the task when the form opens, without asking a model", async () => {
      const user = userEvent.setup();
      replies["POST pr-draft"] = { status: 200, body: { ok: true, title: "Create prueba.md", body: "## Summary\nCreate a file.", model: "template" } };
      show();
      await user.click(await screen.findByRole("button", { name: "Open pull request" }));
      const form = await screen.findByRole("form", { name: /pull request for docs\/one/i });
      await waitFor(() => expect((within(form).getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).value).toBe("## Summary\nCreate a file."));
      expect(posts().filter((p) => p.url.endsWith("pr-draft")).map((p) => p.body)).toEqual([{ template: true }]);
      expect(within(form).getByText(/built from the task/i)).toBeTruthy();
      expect(within(form).queryByText(/composer/i)).toBeNull();
    });

    it("improves the description with the model only when asked, and says which model wrote it", async () => {
      const user = userEvent.setup();
      replies["POST pr-draft"] = { status: 200, body: { ok: true, title: "Create prueba.md", body: "from the task", model: "template" } };
      show();
      await user.click(await screen.findByRole("button", { name: "Open pull request" }));
      const form = await screen.findByRole("form", { name: /pull request for docs\/one/i });
      await waitFor(() => expect((within(form).getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).value).toBe("from the task"));
      replies["POST pr-draft"] = { status: 200, body: { ok: true, title: "Add prueba.md", body: "polished", model: "composer-2.5-fast" } };
      await user.click(within(form).getByRole("button", { name: "Improve with the model" }));
      await waitFor(() => expect((within(form).getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement).value).toBe("polished"));
      expect(posts().filter((p) => p.url.endsWith("pr-draft")).map((p) => p.body)).toEqual([{ template: true }, {}]);
      expect(within(form).getByText(/written by composer-2.5-fast/i)).toBeTruthy();
      expect(within(form).queryByRole("button", { name: "Improve with the model" })).toBeNull();
    });

    it("shows that it is working while the description is prepared: a spinner, a busy form and fields that wait", async () => {
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
      expect(within(form).getByRole("progressbar", { name: /preparing the description/i })).toBeTruthy();
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

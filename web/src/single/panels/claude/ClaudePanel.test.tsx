import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentView, SessionDetail, SessionEvent, SessionListEntry } from "../../../sessions/types";
import { resetSessionTitles } from "../../../sessions/useSessionTitles";
import { ClaudePanel } from "./ClaudePanel";

const PROPS = { board: undefined, runId: undefined, live: false, renderDetail: undefined, selectRun: () => {}, agentId: "alpha" };
const panel = () => <ClaudePanel {...PROPS} />;
/** Opens the conversation history and picks a session from it. */
async function pick(user: ReturnType<typeof userEvent.setup>, name: RegExp): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Conversation history" }));
  await user.click(within(screen.getByRole("dialog", { name: "Conversation history" })).getByRole("button", { name }));
}

const NOW_ISO = new Date().toISOString();
const caps = { resume: true, chooseModel: false, commandList: false, visibleReasoning: false, planUsage: false };

/** Two agents that differ only in what they declare: the page must behave from that alone. */
const AGENTS: AgentView[] = [
  { id: "alpha", label: "Alpha", capabilities: { ...caps, chooseModel: true, commandList: true, planUsage: true }, profileFields: ["model", "effort"] },
  { id: "beta", label: "Beta", capabilities: { ...caps, resume: false, visibleReasoning: true }, profileFields: [] },
];

const entry = (id: string, agent: string): SessionListEntry => ({
  session: { id, agent, title: `Session ${id}`, cwd: "/repo", createdAt: NOW_ISO, updatedAt: NOW_ISO, status: "idle" },
  turnCount: 1,
  inputTokens: 1000,
  outputTokens: 200,
});

const detail = (id: string, agent: string, over: Partial<SessionDetail> = {}): SessionDetail => ({
  session: { ...entry(id, agent).session, agentSessionId: "agent-sess-1" },
  turns: [{ id: 1, sessionId: id, seq: 1, prompt: "Plan the board", startedAt: NOW_ISO, status: "passed", inputTokens: 1000, outputTokens: 200 }],
  meta: { commands: [], planUsage: [] },
  lastEventId: 2,
  ...over,
});

const EVENTS: SessionEvent[] = [
  { id: 1, turnId: 1, ts: NOW_ISO, kind: "thinking", payload: { text: "", shared: false }, agent: "alpha" },
  { id: 2, turnId: 1, ts: NOW_ISO, kind: "message", payload: { text: "<b>Here is the plan</b>" }, agent: "alpha" },
];

interface Posted {
  url: string;
  body: unknown;
}
let posted: Posted[];
let details: Record<string, SessionDetail>;

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: { method?: string; body?: string }) => {
      const url = String(input);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (init?.method === "POST") {
        posted.push({ url, body: JSON.parse(init.body ?? "null") });
        return url === "/api/sessions" ? json({ sessionId: "chat-new" }, 202) : json({ sessionId: "a1" }, 202);
      }
      if (url === "/api/agents") return json({ agents: AGENTS, cwd: "/work/repo" });
      if (url === "/api/agents/alpha/usage") return json({ windows: [{ label: "Current session", percent: 36, resets: "Nov 9, 3:10am" }], checkedAt: NOW_ISO });
      if (url === "/api/agents/alpha/models") return json({ models: ["alpha-fast", "alpha-deep"] });
      if (url === "/api/sessions") return json({ sessions: [...(posted.some((p) => p.url === "/api/sessions") ? [entry("chat-new", "alpha")] : []), entry("a1", "alpha"), entry("a2", "alpha"), entry("b1", "beta")] });
      const events = /^\/api\/sessions\/([^/]+)\/events/.exec(url);
      if (events) return json({ events: events[1] === "a1" ? EVENTS : [], lastEventId: 2 });
      const one = /^\/api\/sessions\/([^/?]+)$/.exec(url);
      if (one && details[one[1]!]) return json(details[one[1]!]);
      return json({ error: `unexpected ${url}` }, 404);
    }),
  );
}

beforeEach(() => {
  posted = [];
  details = {
    a1: detail("a1", "alpha", {
      meta: { commands: ["compact"], planUsage: [{ name: "five_hour", utilization: 0.4 }] },
      continueCommand: "cd '/repo' && alpha --resume agent-sess-1",
    }),
    a2: detail("a2", "alpha"),
    b1: detail("b1", "beta"),
  };
  window.localStorage.clear();
  resetSessionTitles();
  window.location.hash = "";
  stubFetch();
});
afterEach(() => vi.unstubAllGlobals());

describe("ClaudePanel: an open session", () => {
  it("draws the conversation as chat bubbles: yours on the right with the time, Claude's on the left, no turn labels", async () => {
    render(panel());
    await screen.findByText("<b>Here is the plan</b>");
    const mine = screen.getByText("Plan the board").closest(".tl-entry")!;
    expect(mine.getAttribute("data-side")).toBe("me");
    expect(mine.textContent).toContain(new Date(NOW_ISO).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    expect(screen.queryByText(/You · turn/)).toBeNull();
    expect(screen.getByText("<b>Here is the plan</b>").closest(".tl-entry")!.getAttribute("data-side")).toBe("agent");
  });

  it("lists the sessions and shows the open one's timeline as text, with the reasoning note", async () => {
    render(panel());
    await screen.findByText("<b>Here is the plan</b>");
    expect(screen.getByText("Plan the board")).toBeTruthy();
    expect(screen.getByText("Reasoning not shared by the agent")).toBeTruthy();
    // Untrusted output never becomes markup.
    expect(document.querySelector("b")).toBeNull();
  });

  it("shows the plan usage and the tokens, and no terminal command card", async () => {
    render(panel());
    await screen.findByText("<b>Here is the plan</b>");
    expect((await screen.findByRole("meter", { name: "Current session" })).getAttribute("aria-valuenow")).toBe("36");
    expect(screen.getByText("1.2k tokens in this conversation")).toBeTruthy();
    expect(screen.queryByText(/continue in a terminal/i)).toBeNull();
    expect(screen.queryByText("cd '/repo' && alpha --resume agent-sess-1")).toBeNull();
  });

  it("keeps the chat out of the class the agent's timeline list uses, so one cannot restyle the other", async () => {
    render(panel());
    await screen.findByText("<b>Here is the plan</b>");
    const chat = screen.getByRole("log", { name: "Conversation" });
    expect(chat.classList.contains("timeline")).toBe(false);
    expect(chat.classList.contains("chat-timeline")).toBe(true);
  });

  it("offers the agent's own commands and the capability-gated Knit commands in the palette", async () => {
    const user = userEvent.setup();
    render(panel());
    await screen.findByText("<b>Here is the plan</b>");
    await user.type(screen.getByRole("combobox", { name: /message alpha/i }), "/");
    const names = within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.querySelector(".command-palette__name")?.textContent);
    expect(names).toEqual(["/clear", "/model", "/usage", "/compact"]);
  });

  it("an agent without those capabilities gets no model picker, no /usage and no terminal command", async () => {
    render(<ClaudePanel {...PROPS} agentId="beta" />);
    await screen.findByText("Plan the board");
    expect(screen.queryByRole("region", { name: "Plan usage" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Model and effort" })).toBeNull();
    // It cannot resume, so continuing here is not offered either.
    expect(screen.getByText(/cannot continue this conversation here/)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /message beta/i })).toBeNull();
  });

  it("sends a turn with the picked profile and reads again", async () => {
    const user = userEvent.setup();
    render(panel());
    await screen.findByText("<b>Here is the plan</b>");
    await user.click(screen.getByRole("button", { name: "Model and effort" }));
    await user.click(await screen.findByRole("radio", { name: "alpha-deep" }));
    fireEvent.change(screen.getByRole("slider", { name: "Effort" }), { target: { value: "3" } });
    await user.type(screen.getByRole("combobox", { name: /message alpha/i }), "Next step{Enter}");
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ url: "/api/sessions/a1/turns", body: { prompt: "Next step", profile: { model: "alpha-deep", effort: "high" } } });
  });

  it("/usage sends a /usage turn to an agent that reports plan usage", async () => {
    const user = userEvent.setup();
    render(panel());
    await screen.findByText("<b>Here is the plan</b>");
    await user.type(screen.getByRole("combobox", { name: /message alpha/i }), "/usage{Enter}");
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ url: "/api/sessions/a1/turns", body: { prompt: "/usage" } });
  });

  it("disables sending while a turn runs", async () => {
    details.a1 = detail("a1", "alpha", {
      session: { ...entry("a1", "alpha").session, status: "running", agentSessionId: "s" },
      turns: [{ id: 1, sessionId: "a1", seq: 1, prompt: "go", startedAt: NOW_ISO, status: "running" }],
    });
    render(panel());
    await screen.findByText("A turn is running…");
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the server's message when a turn is refused", async () => {
    const user = userEvent.setup();
    render(panel());
    await screen.findByText("<b>Here is the plan</b>");
    const base = globalThis.fetch as unknown as (input: string, init?: unknown) => Promise<Response>;
    vi.stubGlobal("fetch", (input: string, init?: { method?: string }) =>
      init?.method === "POST" ? Promise.resolve(new Response(JSON.stringify({ error: "Session a1 already has a turn running" }), { status: 409 })) : base(input, init),
    );
    await user.type(screen.getByRole("combobox", { name: /message alpha/i }), "again{Enter}");
    expect((await screen.findByRole("alert")).textContent).toBe("Session a1 already has a turn running");
    expect((screen.getByRole("combobox", { name: /message alpha/i }) as HTMLTextAreaElement).value).toBe("again");
  });

  it("starts a new session with /clear", async () => {
    const user = userEvent.setup();
    render(panel());
    await screen.findByText("<b>Here is the plan</b>");
    await user.type(screen.getByRole("combobox", { name: /message alpha/i }), "/clear{Enter}");
    expect(await screen.findByRole("heading", { name: "Plan with Alpha" })).toBeTruthy();
    expect(window.location.hash).toBe("");
  });

  it("switching to a session navigates to it", async () => {
    const user = userEvent.setup();
    render(panel());
    await screen.findByText("<b>Here is the plan</b>");
    await pick(user, /Session a2/);
    expect(await within(screen.getByRole("banner")).findByRole("heading", { name: "Session a2" })).toBeTruthy();
    expect(window.location.hash).toBe("");
  });
});

describe("ClaudePanel: a new session", () => {
  it("starts in the directory the server reported, with the profile, and asks for no directory or agent", async () => {
    const user = userEvent.setup();
    details["chat-new"] = detail("chat-new", "alpha");
    render(panel());
    await user.click(await screen.findByRole("button", { name: "New session" }));
    expect(screen.queryByLabelText("Directory")).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByText(/first message creates the session/i)).toBeNull();
    await user.type(screen.getByRole("combobox", { name: /message alpha/i }), "Plan it{Enter}");
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ url: "/api/sessions", body: { agent: "alpha", cwd: "/work/repo", prompt: "Plan it", profile: {} } });
    expect(await within(screen.getByRole("banner")).findByRole("heading", { name: "Session chat-new" })).toBeTruthy();
  });

  it("is only about its own agent: the history lists that agent's sessions and no other", async () => {
    const user = userEvent.setup();
    render(panel());
    await screen.findByText("<b>Here is the plan</b>");
    await user.click(screen.getByRole("button", { name: "Conversation history" }));
    const history = within(screen.getByRole("dialog", { name: "Conversation history" }));
    expect(history.getByRole("button", { name: /Session a2/ })).toBeTruthy();
    expect(history.queryByRole("button", { name: /Session b1/ })).toBeNull();
  });

  it("shows what to do first instead of a form", async () => {
    const user = userEvent.setup();
    render(panel());
    await user.click(await screen.findByRole("button", { name: "New session" }));
    expect(await screen.findByRole("heading", { name: "Plan with Alpha" })).toBeTruthy();
  });
});

describe("ClaudePanel: plan handoff", () => {
  const draft = (over: Record<string, unknown> = {}) => ({
    path: "/repo/docs/plans/login.md",
    file: "login.md",
    modifiedAt: NOW_ISO,
    name: "Add login",
    valid: true,
    issues: [],
    tasks: [{ id: "T1", title: "Form", branch: "feat/form" }],
    runs: [],
    ...over,
  });

  function withPlans(plans: unknown[]): void {
    const base = globalThis.fetch as unknown as (input: string, init?: { method?: string; body?: string }) => Promise<Response>;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: { method?: string; body?: string }) => {
        if (String(input) === "/api/sessions/a1/plans") return new Response(JSON.stringify({ dir: "docs/plans", plans }), { status: 200 });
        if (init?.method === "POST" && String(input) === "/api/runs") {
          posted.push({ url: String(input), body: JSON.parse(init.body ?? "null") });
          return new Response(JSON.stringify({ runId: "run-1" }), { status: 202 });
        }
        return base(input, init);
      }),
    );
  }

  it("shows the draft with its validation result and starts nothing until Send plan to the orchestrator is clicked", async () => {
    const user = userEvent.setup();
    withPlans([draft()]);
    render(panel());
    await screen.findByText("Add login");
    expect(screen.getByText("Valid")).toBeTruthy();
    expect(posted).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Send plan to the orchestrator" }));
    await waitFor(() => expect(posted).toEqual([{ url: "/api/runs", body: { planPath: "/repo/docs/plans/login.md" } }]));
  });

  const ago = (ms: number): string => new Date(Date.now() + ms).toISOString();
  const show = (extra: Partial<Parameters<typeof ClaudePanel>[0]> = {}) => {
    const selectRun = vi.fn();
    const openPanel = vi.fn();
    render(<ClaudePanel {...PROPS} selectRun={selectRun} openPanel={openPanel} {...extra} />);
    return { selectRun, openPanel };
  };

  it("lets the draft be hidden to read the chat above it, and shown again", async () => {
    const user = userEvent.setup();
    withPlans([draft()]);
    show();
    await screen.findByText("Add login");
    const toggle = screen.getByRole("button", { name: /draft plans/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await user.click(toggle);
    expect(screen.queryByRole("button", { name: "Send plan to the orchestrator" })).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Send plan to the orchestrator" })).toBeTruthy();
  });

  it("does not offer a plan again once a run was started from it after it was last written, and offers it again if it changed since", async () => {
    withPlans([draft({ runs: [{ id: "run-9", status: "passed", startedAt: ago(60_000) }] })]);
    const first = render(panel());
    await screen.findByText("<b>Here is the plan</b>");
    expect(screen.queryByRole("button", { name: "Send plan to the orchestrator" })).toBeNull();
    first.unmount();
    withPlans([draft({ runs: [{ id: "run-9", status: "passed", startedAt: ago(-3_600_000) }] })]);
    render(panel());
    expect(await screen.findByRole("button", { name: "Send plan to the orchestrator" })).toBeTruthy();
  });

  it("replaces the draft with a small Runs line that opens the orchestrator on that run, and drops it with the next prompt", async () => {
    const user = userEvent.setup();
    withPlans([draft()]);
    const { selectRun, openPanel } = show();
    await user.click(await screen.findByRole("button", { name: "Send plan to the orchestrator" }));
    const strip = await screen.findByRole("group", { name: "Runs started" });
    expect(screen.queryByRole("button", { name: "Send plan to the orchestrator" })).toBeNull();
    await user.click(within(strip).getByRole("button", { name: /run-1/ }));
    expect(selectRun).toHaveBeenCalledWith("run-1");
    expect(openPanel).toHaveBeenCalledWith("knit");
    await user.type(screen.getByRole("combobox", { name: /message alpha/i }), "Next{Enter}");
    await waitFor(() => expect(screen.queryByRole("group", { name: "Runs started" })).toBeNull());
  });

  it("shows the issues of an invalid draft and cannot launch it", async () => {
    withPlans([draft({ valid: false, issues: ["T1 has no goal"], tasks: [] })]);
    render(panel());
    await screen.findByText("T1 has no goal");
    const send = screen.getByRole("button", { name: "Send plan to the orchestrator" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(screen.getByText(/Fix 1 issue/)).toBeTruthy();
  });
});

describe("ClaudePanel: the session bar", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSessionTitles();
  });

  it("shows the title with the history and new-session buttons at the right end, and no working directory", async () => {
    render(panel());
    await screen.findByText("<b>Here is the plan</b>");
    const bar = screen.getByRole("banner");
    expect(within(bar).getByRole("heading", { name: "Session a1" })).toBeTruthy();
    expect(within(bar).queryByText("/repo")).toBeNull();
    const history = within(bar).getByRole("button", { name: "Conversation history" });
    const add = within(bar).getByRole("button", { name: "New session" });
    expect(history.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lets the title be renamed to anything, keeps it for that conversation, and shows it in the history", async () => {
    const user = userEvent.setup();
    const { unmount } = render(panel());
    await screen.findByText("<b>Here is the plan</b>");
    await user.click(screen.getByRole("button", { name: "Rename conversation" }));
    const field = screen.getByRole("textbox", { name: "Conversation title" });
    await user.clear(field);
    await user.type(field, "Billing webhooks plan{Enter}");
    expect(within(screen.getByRole("banner")).getByRole("heading", { name: "Billing webhooks plan" })).toBeTruthy();
    // The pencil gets the focus back, and the Enter that saved did not press it.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename conversation" })));
    expect(screen.queryByRole("textbox", { name: "Conversation title" })).toBeNull();
    unmount();
    render(panel());
    expect(await screen.findByRole("heading", { name: "Billing webhooks plan" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Conversation history" }));
    expect(within(screen.getByRole("dialog", { name: "Conversation history" })).getByRole("button", { name: /Billing webhooks plan/ })).toBeTruthy();
  });

  it("leaves the title alone on Escape, and an empty title goes back to the original", async () => {
    const user = userEvent.setup();
    render(panel());
    await screen.findByText("<b>Here is the plan</b>");
    await user.click(screen.getByRole("button", { name: "Rename conversation" }));
    await user.type(screen.getByRole("textbox", { name: "Conversation title" }), "zzz{Escape}");
    expect(screen.getByRole("heading", { name: "Session a1" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Rename conversation" }));
    const field = screen.getByRole("textbox", { name: "Conversation title" });
    await user.clear(field);
    await user.type(field, "Temporary{Enter}");
    await user.click(screen.getByRole("button", { name: "Rename conversation" }));
    await user.clear(screen.getByRole("textbox", { name: "Conversation title" }));
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "Session a1" })).toBeTruthy();
  });

  it("does not offer to rename a conversation that has not started", async () => {
    const user = userEvent.setup();
    render(panel());
    await user.click(await screen.findByRole("button", { name: "New session" }));
    expect(screen.getByRole("heading", { name: "New conversation" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Rename conversation" })).toBeNull();
  });

  it("shows the chat and the usage side by side, each with its own scroll, and no tabs", async () => {
    render(panel());
    await screen.findByText("<b>Here is the plan</b>");
    expect(screen.queryByRole("tab")).toBeNull();
    const chat = screen.getByRole("log", { name: "Conversation" });
    const side = screen.getByRole("complementary", { name: "Usage and status" });
    expect(chat.contains(side)).toBe(false);
    expect(within(side).getByRole("region", { name: "Claude" })).toBeTruthy();
    expect(await within(side).findByRole("meter", { name: "Current session" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /message alpha/i })).toBeTruthy();
  });

  it("keeps the usage sidebar in a conversation that has not started", async () => {
    const user = userEvent.setup();
    render(panel());
    await user.click(await screen.findByRole("button", { name: "New session" }));
    expect(screen.getByRole("complementary", { name: "Usage and status" })).toBeTruthy();
  });

  it("keeps the model chip and the pick visible", async () => {
    const user = userEvent.setup();
    render(panel());
    await screen.findByText("<b>Here is the plan</b>");
    await user.click(screen.getByRole("button", { name: "Model and effort" }));
    await user.click(await screen.findByRole("radio", { name: "alpha-deep" }));
    expect(screen.getByRole("button", { name: "Model and effort" }).textContent).toContain("alpha-deep");
  });

  it("opens on the most recent session and keeps the choice in the panel, not in the URL", async () => {
    render(panel());
    expect(await screen.findByText("<b>Here is the plan</b>")).toBeTruthy();
    expect(window.location.hash).toBe("");
  });
});

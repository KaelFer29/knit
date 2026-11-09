import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentView, SessionDetail, SessionEvent, SessionListEntry } from "../../../sessions/types";
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
  window.location.hash = "";
  stubFetch();
});
afterEach(() => vi.unstubAllGlobals());

describe("ClaudePanel: an open session", () => {
  it("lists the sessions and shows the open one's timeline as text, with the reasoning note", async () => {
    render(panel());
    await screen.findByText("<b>Here is the plan</b>");
    expect(screen.getByText("Plan the board")).toBeTruthy();
    expect(screen.getByText("Reasoning not shared by the agent")).toBeTruthy();
    // Untrusted output never becomes markup.
    expect(document.querySelector("b")).toBeNull();
  });

  it("shows the terminal command and the plan usage of an agent that declares them", async () => {
    render(panel());
    await screen.findByText("cd '/repo' && alpha --resume agent-sess-1");
    expect(screen.getByRole("progressbar", { name: "5-hour window" }).getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByText("1.2k")).toBeTruthy();
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
    await screen.findByText("This agent does not report plan usage.");
    expect(screen.queryByRole("button", { name: "Model and effort" })).toBeNull();
    expect(screen.queryByText("Continue in terminal")).toBeNull();
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
    await user.click(within(screen.getByRole("radiogroup", { name: "Effort" })).getByRole("radio", { name: "high" }));
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
    expect(screen.getByRole("status", { name: "" }) ?? true).toBeTruthy();
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

  it("shows the issues of an invalid draft and cannot launch it", async () => {
    withPlans([draft({ valid: false, issues: ["T1 has no goal"], tasks: [] })]);
    render(panel());
    await screen.findByText("T1 has no goal");
    const send = screen.getByRole("button", { name: "Send plan to the orchestrator" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(screen.getByText(/Fix 1 issue/)).toBeTruthy();
  });
});

describe("ClaudePanel: header", () => {
  it("shows the session title and the working directory, and the model chip shows the pick", async () => {
    const user = userEvent.setup();
    render(panel());
    await screen.findByText("<b>Here is the plan</b>");
    await user.click(screen.getByRole("button", { name: "Model and effort" }));
    await user.click(await screen.findByRole("radio", { name: "alpha-deep" }));
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("heading", { name: "Session a1" })).toBeTruthy();
    expect(within(header).getByText("/repo")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Model and effort" }).textContent).toContain("alpha-deep");
  });

  it("opens on the most recent session and keeps the choice in the panel, not in the URL", async () => {
    render(panel());
    expect(await screen.findByText("<b>Here is the plan</b>")).toBeTruthy();
    expect(window.location.hash).toBe("");
  });
});

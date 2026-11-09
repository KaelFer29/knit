import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeAgentRunner } from "../../src/adapters/agents/claude/claude-runner.js";
import { SqliteSessionStore } from "../../src/adapters/storage/sqlite/session-store.js";
import { main, type CliDeps } from "../../src/cli/main.js";
import type { AgentOptions } from "../../src/cli/types.js";
import type { AgentCapabilities, AgentRunRequest, AgentRunner } from "../../src/core/ports/agent-runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const fakeClaude = resolve(here, "../../src/adapters/agents/claude/__fixtures__/fake-claude.mjs");

let scratch: string;
let repo: string;
let dataDir: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "orq-chat-"));
  repo = join(scratch, "target");
  dataDir = join(scratch, "data");
  mkdirSync(repo);
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s: string) => void out.push(s), err: (s: string) => void err.push(s) }, out: () => out.join(""), err: () => err.join("") };
}

/** What the fake binary and the runner saw, for every turn of a test. */
interface Seen {
  options: AgentOptions[];
  requests: AgentRunRequest[];
  /** argv and cwd the fake `claude` reports in its init event. */
  calls: { argv: string[]; cwd: string }[];
}

/** The real Claude adapter pointed at the fake binary; records how it was built and called. */
function claudeDeps(seen: Seen): CliDeps {
  return {
    cwd: scratch,
    env: { KNIT_HOME: dataDir },
    agent: (options) => {
      seen.options.push(options);
      const real = new ClaudeAgentRunner({
        command: process.execPath,
        prefixArgs: [fakeClaude],
        killGraceMs: 200,
        ...(options.model ? { model: options.model } : {}),
        ...(options.effort ? { effort: options.effort } : {}),
        ...(options.permissionMode ? { permissionMode: options.permissionMode } : {}),
      });
      return {
        name: real.name,
        capabilities: real.capabilities,
        run: (request, onEvent) => {
          seen.requests.push(request);
          return real.run(request, (e) => {
            const raw = e.raw as { type?: string; subtype?: string; argv?: string[]; cwd?: string };
            if (raw.type === "system" && raw.subtype === "init") seen.calls.push({ argv: raw.argv ?? [], cwd: raw.cwd ?? "" });
            onEvent?.(e);
          });
        },
      };
    },
  };
}

const newSeen = (): Seen => ({ options: [], requests: [], calls: [] });

const sessionIdOf = (text: string): string => /Session: (chat-[\w-]+)/.exec(text)![1]!;

function openStore(): SqliteSessionStore {
  return new SqliteSessionStore(join(dataDir, "knit.db"));
}

describe("knit chat with Claude", () => {
  it("runs a first turn in the given directory and records the session, the turn and its timeline", async () => {
    const seen = newSeen();
    const c = capture();
    const code = await main(["chat", "Plan the board MODE:ok", "--cwd", repo], c.io, claudeDeps(seen));

    expect(code).toBe(0);
    const id = sessionIdOf(c.out());
    expect(c.out()).toContain("tool ▶"); // the timeline streams as it happens
    expect(c.out()).toMatch(/\nok\n/); // the final answer
    expect(c.out()).toContain(`chat --session ${id}`);
    expect(c.out()).not.toContain("[run]");

    // The binary ran in the repository, with the user's normal configuration (no strict MCP) and no resume.
    expect(realpathSync(seen.calls[0]!.cwd)).toBe(realpathSync(repo));
    expect(seen.calls[0]!.argv).not.toContain("--resume");
    expect(seen.calls[0]!.argv).not.toContain("--strict-mcp-config");
    expect(seen.options[0]).toEqual({ agent: "claude" });

    const store = openStore();
    try {
      expect(store.getSession(id)).toMatchObject({
        agent: "claude", title: "Plan the board MODE:ok", cwd: repo, agentSessionId: "sess-claude-1", status: "idle",
      });
      const [turn, ...rest] = store.listTurns(id);
      expect(rest).toEqual([]);
      expect(turn).toMatchObject({
        seq: 1, prompt: "Plan the board MODE:ok", status: "passed", resultText: "ok", exitCode: 0,
        inputTokens: 4 + 42300 + 91444, outputTokens: 81,
      });
      expect(turn!.meta?.commands).toEqual(["compact", "context", "usage", "clear", "model", "my-skill"]);
      expect(turn!.meta?.planUsage).toHaveLength(2);
      expect(turn).not.toHaveProperty("pid");
      const events = store.getEvents(id);
      expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["system", "tool_started", "tool_completed", "message", "result"]));
      expect(new Set(events.map((e) => e.agent))).toEqual(new Set(["claude"]));
      expect(new Set(events.map((e) => e.turnId))).toEqual(new Set([turn!.id]));
    } finally {
      store.close();
    }
  });

  it("records the pid of the process while the turn runs", async () => {
    const seen = newSeen();
    const deps = claudeDeps(seen);
    const during: (number | undefined)[] = [];
    const inner = deps.agent!;
    deps.agent = (o) => {
      const runner = inner(o);
      return {
        ...runner,
        run: (r, onEvent) => {
          const store = openStore();
          try {
            during.push(store.listTurns(store.listSessions()[0]!.id)[0]?.pid);
          } finally {
            store.close();
          }
          return runner.run(r, onEvent);
        },
      };
    };
    await main(["chat", "hi MODE:ok", "--cwd", repo], capture().io, deps);
    expect(during).toEqual([process.pid]);
  });

  it("continues the same session on a second turn by resuming the agent's own session", async () => {
    const seen = newSeen();
    const first = capture();
    await main(["chat", "first MODE:ok", "--cwd", repo], first.io, claudeDeps(seen));
    const id = sessionIdOf(first.out());

    const second = capture();
    // Another working directory on purpose: the session remembers where it runs.
    const code = await main(["chat", "second MODE:resume", "--session", id], second.io, { ...claudeDeps(seen), cwd: scratch });
    expect(code).toBe(0);
    expect(sessionIdOf(second.out())).toBe(id);

    const argv = seen.calls[1]!.argv;
    expect(argv.slice(argv.indexOf("--resume"), argv.indexOf("--resume") + 2)).toEqual(["--resume", "sess-claude-1"]);
    expect(seen.requests[1]).toMatchObject({ resumeSessionId: "sess-claude-1", cwd: repo });
    expect(realpathSync(seen.calls[1]!.cwd)).toBe(realpathSync(repo));

    const store = openStore();
    try {
      expect(store.listSessions()).toHaveLength(1);
      expect(store.listTurns(id).map((t) => [t.seq, t.prompt, t.status])).toEqual([
        [1, "first MODE:ok", "passed"],
        [2, "second MODE:resume", "passed"],
      ]);
      const [t1, t2] = store.listTurns(id);
      const byTurn = (turnId: number) => store.getEvents(id, { turnId }).length;
      expect(byTurn(t1!.id)).toBeGreaterThan(0);
      expect(byTurn(t2!.id)).toBeGreaterThan(0);
      expect(store.getSession(id)?.title).toBe("first MODE:ok"); // the title stays the first prompt's
    } finally {
      store.close();
    }
  });

  it("passes the per-turn profile to Claude and stores it on the turn", async () => {
    const seen = newSeen();
    const c = capture();
    const code = await main(
      ["chat", "hi MODE:ok", "--cwd", repo, "--model", "opus", "--effort", "high", "--permission-mode", "plan"],
      c.io,
      claudeDeps(seen),
    );
    expect(code).toBe(0);
    const argv = seen.calls[0]!.argv;
    expect(argv).toEqual(expect.arrayContaining(["--model", "opus", "--effort", "high", "--permission-mode", "plan"]));
    const store = openStore();
    try {
      expect(store.listTurns(sessionIdOf(c.out()))[0]!.profile).toEqual({ model: "opus", effort: "high", permissionMode: "plan" });
    } finally {
      store.close();
    }
  });

  it("reports an unknown session without running anything", async () => {
    const seen = newSeen();
    const c = capture();
    const code = await main(["chat", "hi", "--session", "chat-nope"], c.io, claudeDeps(seen));
    expect(code).toBe(1);
    expect(c.err()).toContain("Session not found: chat-nope");
    expect(seen.requests).toEqual([]);
  });

  it("exits 1 and records a failed turn when the agent fails, keeping the session resumable", async () => {
    const seen = newSeen();
    const c = capture();
    const code = await main(["chat", "boom MODE:error", "--cwd", repo], c.io, claudeDeps(seen));
    expect(code).toBe(1);
    expect(c.err()).toContain("Turn failed: model exploded");
    const id = sessionIdOf(c.out());
    const store = openStore();
    try {
      expect(store.listTurns(id)[0]).toMatchObject({ status: "failed", resultText: "model exploded", exitCode: 1 });
      expect(store.getSession(id)).toMatchObject({ status: "idle", agentSessionId: "sess-claude-1" });
    } finally {
      store.close();
    }
  });

  it("exits 1 when the agent process crashes without a result", async () => {
    const c = capture();
    const code = await main(["chat", "x MODE:crash", "--cwd", repo], c.io, claudeDeps(newSeen()));
    expect(code).toBe(1);
    expect(c.err()).toContain("Turn failed");
    const store = openStore();
    try {
      const id = store.listSessions()[0]!.id;
      expect(store.listTurns(id)[0]).toMatchObject({ status: "failed", exitCode: 3 });
      expect(store.listTurns(id)[0]).not.toHaveProperty("pid");
    } finally {
      store.close();
    }
  });

  it("uses the current directory when --cwd is omitted", async () => {
    const seen = newSeen();
    const c = capture();
    await main(["chat", "hi MODE:ok"], c.io, { ...claudeDeps(seen), cwd: repo });
    const store = openStore();
    try {
      expect(store.getSession(sessionIdOf(c.out()))?.cwd).toBe(repo);
    } finally {
      store.close();
    }
  });
});

describe("knit chat argument checks", () => {
  const deps = () => claudeDeps(newSeen());

  it("needs exactly one non-blank prompt", async () => {
    for (const args of [["chat"], ["chat", "   "], ["chat", "a", "b"]]) {
      const c = capture();
      expect(await main(args, c.io, deps())).toBe(2);
      expect(c.err()).toContain("chat needs exactly one prompt");
    }
  });

  it("rejects an unknown agent", async () => {
    const c = capture();
    expect(await main(["chat", "hi", "--agent", "gemini"], c.io, deps())).toBe(2);
    expect(c.err()).toContain("--agent must be one of claude, cursor");
  });

  it("rejects a working directory that does not exist", async () => {
    const c = capture();
    expect(await main(["chat", "hi", "--cwd", join(scratch, "missing")], c.io, deps())).toBe(2);
    expect(c.err()).toContain("--cwd is not a directory");
  });

  it("rejects Claude-only options for Cursor instead of ignoring them", async () => {
    for (const flag of [["--effort", "high"], ["--permission-mode", "plan"]]) {
      const c = capture();
      expect(await main(["chat", "hi", "--agent", "cursor", "--cwd", repo, ...flag], c.io, deps())).toBe(2);
      expect(c.err()).toContain("apply to Claude only");
    }
  });

  it("rejects an --agent or --cwd that contradicts the session", async () => {
    const first = capture();
    await main(["chat", "hi MODE:ok", "--cwd", repo], first.io, deps());
    const id = sessionIdOf(first.out());

    const wrongAgent = capture();
    expect(await main(["chat", "hi", "--session", id, "--agent", "cursor"], wrongAgent.io, deps())).toBe(2);
    expect(wrongAgent.err()).toContain("belongs to claude");

    const wrongCwd = capture();
    expect(await main(["chat", "hi", "--session", id, "--cwd", scratch], wrongCwd.io, deps())).toBe(2);
    expect(wrongCwd.err()).toContain(`runs in ${repo}`);

    const store = openStore();
    try {
      expect(store.listTurns(id)).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("documents the command in the help text", async () => {
    const c = capture();
    await main(["help"], c.io, deps());
    expect(c.err()).toContain("chat <prompt>");
    expect(c.err()).toContain("--session <id>");
    expect(c.err()).toContain("--permission-mode <mode>");
  });
});

/** A runner standing in for an agent that cannot resume (Cursor today). */
function cursorLike(seen: AgentRunRequest[]): AgentRunner {
  const capabilities: AgentCapabilities = { resume: false, chooseModel: true, commandList: false, visibleReasoning: true, planUsage: false };
  return {
    name: "cursor",
    capabilities,
    run: async (request, onEvent) => {
      seen.push(request);
      onEvent?.({ type: "thinking", raw: { type: "thinking", subtype: "delta", text: "Looking around" } });
      onEvent?.({ type: "thinking", raw: { type: "thinking", subtype: "completed" } });
      onEvent?.({ type: "assistant", raw: { type: "assistant", message: { content: [{ type: "text", text: "Found it" }] } } });
      return { exitCode: 0, isError: false, resultText: "cursor says hi", durationMs: 4, inputTokens: 7, outputTokens: 2, sessionId: "cursor-chat-1", timedOut: false };
    },
  };
}

describe("knit chat with Cursor", () => {
  it("records a Cursor turn through the same tables, labelled cursor", async () => {
    const requests: AgentRunRequest[] = [];
    const options: AgentOptions[] = [];
    const c = capture();
    const code = await main(["chat", "look around", "--agent", "cursor", "--cwd", repo, "--model", "auto"], c.io, {
      cwd: scratch,
      env: { KNIT_HOME: dataDir },
      agent: (o) => {
        options.push(o);
        return cursorLike(requests);
      },
    });
    expect(code).toBe(0);
    expect(options).toEqual([{ agent: "cursor", model: "auto" }]);
    expect(c.out()).toContain("cursor says hi");
    const store = openStore();
    try {
      const id = sessionIdOf(c.out());
      expect(store.getSession(id)).toMatchObject({ agent: "cursor", agentSessionId: "cursor-chat-1" });
      expect(store.getEvents(id).map((e) => [e.kind, e.agent])).toEqual([["thinking", "cursor"], ["message", "cursor"]]);
      expect(store.listTurns(id)[0]).toMatchObject({ status: "passed", inputTokens: 7, outputTokens: 2, profile: { model: "auto" } });
    } finally {
      store.close();
    }
  });

  it("refuses a second turn clearly, because the Cursor adapter cannot resume, and records nothing", async () => {
    const requests: AgentRunRequest[] = [];
    const deps: CliDeps = { cwd: scratch, env: { KNIT_HOME: dataDir }, agent: () => cursorLike(requests) };
    const first = capture();
    await main(["chat", "one", "--agent", "cursor", "--cwd", repo], first.io, deps);
    const id = sessionIdOf(first.out());

    const second = capture();
    const code = await main(["chat", "two", "--session", id], second.io, deps);
    expect(code).toBe(2);
    expect(second.err()).toMatch(/cannot resume/);
    expect(requests).toHaveLength(1);
    const store = openStore();
    try {
      expect(store.listTurns(id)).toHaveLength(1);
      expect(store.getSession(id)?.status).toBe("idle");
    } finally {
      store.close();
    }
  });
});

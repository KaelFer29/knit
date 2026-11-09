import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeAgentRunner } from "../../src/adapters/agents/claude/claude-runner.js";
import { SqliteSessionReader } from "../../src/adapters/storage/sqlite/session-reader.js";
import { SqliteSessionStore } from "../../src/adapters/storage/sqlite/session-store.js";
import { agentInfos } from "../../src/cli/commands/ui.js";
import { main, type CliDeps } from "../../src/cli/main.js";
import type { AgentRunner } from "../../src/core/ports/agent-runner.js";
import type { RunReader } from "../../src/core/ports/run-reader.js";
import { startServer, type RunningServer, type SpawnRequest } from "../../src/server/index.js";
import { lazySessionReader } from "../../src/server/routes/sessions.js";

const here = dirname(fileURLToPath(import.meta.url));
const fakeClaude = resolve(here, "../../src/adapters/agents/claude/__fixtures__/fake-claude.mjs");

let scratch: string;
let repo: string;
let dataDir: string;
let server: RunningServer | undefined;
let spawned: SpawnRequest[];

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "knit-sessions-ui-")));
  repo = join(scratch, "target");
  dataDir = join(scratch, "data");
  mkdirSync(repo);
  mkdirSync(dataDir);
  spawned = [];
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  rmSync(scratch, { recursive: true, force: true });
});

const emptyRunReader: RunReader = {
  listRuns: () => [],
  getRunSnapshot: () => undefined,
  getRun: () => undefined,
  getLatestAgentEvents: () => [],
  getEventsAfter: () => [],
  getAgentEventsAfter: () => [],
  close: () => {},
};

/** The real Claude adapter pointed at the fake binary. */
function fakeAgent(agent: string): AgentRunner {
  const real = new ClaudeAgentRunner({ command: process.execPath, prefixArgs: [fakeClaude], killGraceMs: 200 });
  return agent === "claude"
    ? real
    : { name: "cursor", capabilities: { resume: false, chooseModel: false, commandList: false, visibleReasoning: true, planUsage: false }, run: real.run.bind(real) };
}

function chatDeps(cwd: string): CliDeps {
  return { cwd, env: {}, agent: (o) => fakeAgent(o.agent ?? "claude") };
}

async function launch(): Promise<RunningServer> {
  // Make sure the database exists before the reader opens it, like after any earlier `knit chat`.
  new SqliteSessionStore(join(dataDir, "knit.db")).close();
  const reader = lazySessionReader(() => new SqliteSessionReader(join(dataDir, "knit.db")));
  server = await startServer({
    reader: emptyRunReader,
    port: 0,
    staticDir: join(scratch, "no-web"),
    pollIntervalMs: 20,
    control: {
      dataDir,
      registerTimeoutMs: 8000,
      sessions: { reader, agents: agentInfos(fakeAgent) },
      // Runs `knit chat` in this process instead of a child: same argument parsing, same database writes.
      spawn: (request) => {
        spawned.push(request);
        const exited = main(request.args, { out: () => {}, err: () => {} }, chatDeps(request.cwd ?? scratch));
        return { pid: process.pid, exited };
      },
    },
  });
  return server;
}

interface Reply {
  status: number;
  json: () => any;
}

function call(path: string, method = "GET", body?: unknown, origin = true): Promise<Reply> {
  const s = server!;
  const text = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolveReply, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: s.port,
        method,
        path,
        headers: {
          host: `127.0.0.1:${s.port}`,
          authorization: `Bearer ${s.token}`,
          ...(method !== "GET" && origin ? { origin: `http://127.0.0.1:${s.port}` } : {}),
          ...(text !== undefined ? { "content-type": "application/json", "content-length": Buffer.byteLength(text) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const out = Buffer.concat(chunks).toString("utf8");
          resolveReply({ status: res.statusCode ?? 0, json: () => JSON.parse(out) });
        });
      },
    );
    req.on("error", reject);
    if (text !== undefined) req.write(text);
    req.end();
  });
}

const waitIdle = async (id: string): Promise<void> => {
  for (let i = 0; i < 200; i++) {
    if ((await call(`/api/sessions/${id}`)).json().session.status === "idle") return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("session never became idle");
};

describe("session routes", () => {
  it("lists the agents with their capabilities and profile fields", async () => {
    await launch();
    const { agents, cwd } = (await call("/api/agents")).json();
    expect(agents.map((a: any) => a.id)).toEqual(["claude", "cursor"]);
    expect(cwd).toBe(process.cwd());
    expect(agents[0].capabilities).toMatchObject({ resume: true, chooseModel: true, commandList: true, planUsage: true });
    expect(agents[1].profileFields).toEqual(["model"]);
    expect(agents[1].capabilities.planUsage).toBe(false);
  });

  it("lists models only for agents that let the model be chosen", async () => {
    await launch();
    const claude = (await call("/api/agents/claude/models")).json();
    expect(claude.models.length).toBeGreaterThan(0);
    expect((await call("/api/agents/cursor/models")).json()).toEqual({ models: [] });
    expect((await call("/api/agents/nope/models")).status).toBe(404);
  });

  it("answers empty lists and 404s before any session exists", async () => {
    await launch();
    expect((await call("/api/sessions")).json()).toEqual({ sessions: [] });
    expect((await call("/api/sessions/chat-nope")).status).toBe(404);
    expect((await call("/api/sessions/chat-nope/events")).status).toBe(404);
  });

  it("starts a session by spawning knit chat, then reads it, its meta and the terminal command", async () => {
    await launch();
    const reply = await call("/api/sessions", "POST", { agent: "claude", cwd: repo, prompt: "Plan the board MODE:ok", profile: { model: "haiku" } });
    expect(reply.status).toBe(202);
    const { sessionId } = reply.json();
    expect(spawned[0]!.args).toEqual([
      "chat", "--agent", "claude", "--cwd", repo, "--model", "haiku", "--data-dir", dataDir, "--", "Plan the board MODE:ok",
    ]);
    expect(spawned[0]!.cwd).toBe(repo);
    await waitIdle(sessionId);

    const detail = (await call(`/api/sessions/${sessionId}`)).json();
    expect(detail.session).toMatchObject({ agent: "claude", cwd: repo, agentSessionId: "sess-claude-1" });
    expect(detail.turns).toHaveLength(1);
    expect(detail.turns[0]).toMatchObject({ seq: 1, status: "passed", profile: { model: "haiku" } });
    expect(detail.meta.planUsage.length).toBeGreaterThan(0);
    expect(detail.meta.commands.length).toBeGreaterThan(0);
    expect(detail.continueCommand).toBe(`cd '${repo}' && claude --resume sess-claude-1`);
    expect(detail.lastEventId).toBeGreaterThan(0);

    const list = (await call("/api/sessions")).json().sessions;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ turnCount: 1, session: { id: sessionId } });
  });

  it("resumes the session with a second turn and streams events after an id", async () => {
    await launch();
    const { sessionId } = (await call("/api/sessions", "POST", { agent: "claude", cwd: repo, prompt: "first MODE:ok" })).json();
    await waitIdle(sessionId);
    const first = (await call(`/api/sessions/${sessionId}/events`)).json();
    expect(first.events.length).toBeGreaterThan(0);

    const turn = await call(`/api/sessions/${sessionId}/turns`, "POST", { prompt: "second MODE:resume" });
    expect(turn.status).toBe(202);
    expect(spawned[1]!.args).toEqual(["chat", "--session", sessionId, "--data-dir", dataDir, "--", "second MODE:resume"]);
    expect(spawned[1]!.cwd).toBe(repo);
    await waitIdle(sessionId);

    const more = (await call(`/api/sessions/${sessionId}/events?after=${first.lastEventId}`)).json();
    expect(more.events.length).toBeGreaterThan(0);
    expect(more.events.every((e: any) => e.id > first.lastEventId)).toBe(true);
    expect((await call(`/api/sessions/${sessionId}`)).json().turns.map((t: any) => t.seq)).toEqual([1, 2]);
    expect((await call(`/api/sessions/${sessionId}/events?after=x`)).status).toBe(400);
  });

  it("does not offer a terminal command for an agent that cannot resume", async () => {
    await launch();
    const { sessionId } = (await call("/api/sessions", "POST", { agent: "cursor", cwd: repo, prompt: "hi MODE:ok" })).json();
    await waitIdle(sessionId);
    expect((await call(`/api/sessions/${sessionId}`)).json()).not.toHaveProperty("continueCommand");
    expect((await call(`/api/sessions/${sessionId}/turns`, "POST", { prompt: "again" })).status).toBe(409);
  });

  it("rejects bad requests without spawning anything", async () => {
    await launch();
    const bad = async (body: unknown): Promise<number> => (await call("/api/sessions", "POST", body)).status;
    expect(await bad({ agent: "gemini", cwd: repo, prompt: "x" })).toBe(400);
    expect(await bad({ agent: "claude", cwd: "relative", prompt: "x" })).toBe(400);
    expect(await bad({ agent: "claude", cwd: join(scratch, "missing"), prompt: "x" })).toBe(400);
    expect(await bad({ agent: "claude", cwd: repo, prompt: "  " })).toBe(400);
    expect(await bad({ agent: "claude", cwd: repo, prompt: "x", profile: { model: "--evil" } })).toBe(400);
    expect(await bad({ agent: "cursor", cwd: repo, prompt: "x", profile: { effort: "high" } })).toBe(400);
    expect(await bad({ agent: "claude", cwd: repo, prompt: "x", extra: 1 })).toBe(400);
    expect((await call("/api/sessions/chat-nope/turns", "POST", { prompt: "x" })).status).toBe(404);
    expect(spawned).toEqual([]);
  });

  it("keeps the guard: a POST without Origin is refused and spawns nothing", async () => {
    await launch();
    const reply = await call("/api/sessions", "POST", { agent: "claude", cwd: repo, prompt: "x" }, false);
    expect(reply.status).toBe(403);
    expect(spawned).toEqual([]);
  });

  it("reports a child that dies before recording a turn", async () => {
    await launch();
    await server!.close();
    server = await startServer({
      reader: emptyRunReader,
      port: 0,
      staticDir: join(scratch, "no-web"),
      control: {
        dataDir,
        sessions: { reader: lazySessionReader(() => new SqliteSessionReader(join(dataDir, "knit.db"))), agents: agentInfos(fakeAgent) },
        spawn: () => ({ pid: 1, exited: Promise.resolve(1) }),
      },
    });
    const dead = await call("/api/sessions", "POST", { agent: "claude", cwd: repo, prompt: "x" });
    expect(dead.status).toBe(502);
    expect(dead.json().error).toMatch(/exited/);
  });

  it("answers 503 to a start when the server has no session support", async () => {
    server = await startServer({ reader: emptyRunReader, port: 0, staticDir: join(scratch, "no-web") });
    expect((await call("/api/sessions", "POST", { agent: "claude", cwd: repo, prompt: "x" })).status).toBe(503);
    expect((await call("/api/agents")).json()).toEqual({ agents: [] });
  });
});

import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { AgentPlanUsage, AgentProfile } from "../../core/ports/agent-runner.js";
import type { SessionListItem, SessionReader } from "../../core/ports/session-reader.js";
import type { SessionRecord, StoredSessionEvent, TurnRecord } from "../../core/ports/session-store.js";
import { HttpError, sendJson } from "../http.js";
import type { AgentInfo, ControlDeps, ProfileField, RouteModule, SessionsDeps, SpawnedProcess } from "../types.js";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_PROMPT_CHARS = 32_000;
const DEFAULT_REGISTER_TIMEOUT_MS = 10_000;
const MAX_EVENTS = 2000;
const PROFILE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,99}$/;
const PROFILE_FLAGS: Record<ProfileField, string> = { model: "--model", effort: "--effort", permissionMode: "--permission-mode" };

/**
 * A `SessionReader` for a database that may not exist yet: reads are empty until `open` returns a reader, and a reader
 * that throws is closed and opened again on the next call (same behaviour as `lazyRunReader`).
 */
export function lazySessionReader(open: () => SessionReader | undefined): SessionReader {
  let inner: SessionReader | undefined;
  function use<T>(fallback: T, read: (reader: SessionReader) => T): T {
    if (!inner) {
      try {
        inner = open();
      } catch {
        inner = undefined;
      }
    }
    if (!inner) return fallback;
    try {
      return read(inner);
    } catch (err) {
      try {
        inner.close();
      } catch {
        // already unusable
      }
      inner = undefined;
      throw err;
    }
  }
  return {
    listSessions: () => use([], (r) => r.listSessions()),
    getSession: (id) => use(undefined, (r) => r.getSession(id)),
    listTurns: (id) => use([], (r) => r.listTurns(id)),
    getEvents: (id, filter) => use([], (r) => r.getEvents(id, filter)),
    close: () => {
      inner?.close();
      inner = undefined;
    },
  };
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") throw new HttpError(415, "Content-Type must be application/json");
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new HttpError(413, `Body is larger than ${MAX_BODY_BYTES} bytes`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, `Body is larger than ${MAX_BODY_BYTES} bytes`);
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Body is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new HttpError(400, "Body must be a JSON object");
  return parsed as Record<string, unknown>;
}

interface ChatRequest {
  prompt: string;
  profile: AgentProfile;
}

function parseChatFields(body: Record<string, unknown>, allowed: string[], agent: AgentInfo): ChatRequest {
  const unknown = Object.keys(body).filter((k) => ![...allowed, "prompt", "profile"].includes(k));
  if (unknown.length > 0) throw new HttpError(400, `Unknown field: ${unknown.join(", ")}`);
  const { prompt, profile } = body;
  if (typeof prompt !== "string" || prompt.trim() === "") throw new HttpError(400, "prompt must be a non-empty string");
  if (prompt.length > MAX_PROMPT_CHARS) throw new HttpError(400, `prompt is longer than ${MAX_PROMPT_CHARS} characters`);
  const out: AgentProfile = {};
  if (profile !== undefined) {
    if (typeof profile !== "object" || profile === null || Array.isArray(profile)) throw new HttpError(400, "profile must be an object");
    for (const [key, value] of Object.entries(profile)) {
      if (!(key in PROFILE_FLAGS)) throw new HttpError(400, `Unknown profile field: ${key}`);
      if (value === undefined || value === "") continue;
      if (!agent.profileFields.includes(key as ProfileField)) throw new HttpError(400, `${agent.label} does not take ${key}`);
      if (typeof value !== "string" || !PROFILE_VALUE.test(value)) throw new HttpError(400, `profile.${key} is not a valid value`);
      out[key as ProfileField] = value;
    }
  }
  return { prompt, profile: out };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Registration = { kind: "found" } | { kind: "exited"; code: number | null } | { kind: "timeout" };

/** Polls until `found` holds. A child that exits first is given one last look, and is otherwise reported as exited. */
async function awaitRegistration(child: SpawnedProcess, found: () => boolean, pollMs: number, timeoutMs: number): Promise<Registration> {
  let exit: { code: number | null } | undefined;
  void child.exited.then((code) => {
    exit = { code };
  });
  const end = Date.now() + timeoutMs;
  for (;;) {
    const exited = exit !== undefined;
    let ok = false;
    try {
      ok = found();
    } catch {
      ok = false;
    }
    if (ok) return { kind: "found" };
    if (exited) return { kind: "exited", code: exit!.code };
    if (Date.now() >= end) return { kind: "timeout" };
    await sleep(pollMs);
  }
}

function startChat(control: ControlDeps, args: string[], cwd: string): { child: SpawnedProcess; logPath: string } {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const logPath = join(control.dataDir, "logs", "_ui", `chat-${stamp}-${randomBytes(3).toString("hex")}.log`);
  let child: SpawnedProcess;
  try {
    child = control.spawn({ args, logFile: logPath, cwd });
  } catch (err) {
    throw new HttpError(502, `Could not start knit chat: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (child.pid === undefined) throw new HttpError(502, `Could not start knit chat. Log: ${logPath}`);
  return { child, logPath };
}

function failRegistration(res: ServerResponse, logPath: string, outcome: Registration): void {
  if (outcome.kind === "exited") {
    sendJson(res, 502, { error: `knit chat exited (code ${outcome.code}) before the turn was recorded`, logPath });
  } else {
    sendJson(res, 504, { error: "knit chat started but the turn did not show up in time", logPath });
  }
}

function chatArgs(control: ControlDeps, profile: AgentProfile, prompt: string, target: string[]): string[] {
  const flags = (Object.keys(PROFILE_FLAGS) as ProfileField[]).flatMap((k) => (profile[k] ? [PROFILE_FLAGS[k], profile[k]!] : []));
  // `--` first: a prompt that starts with a dash is a prompt, never an option.
  return ["chat", ...target, ...flags, "--data-dir", control.dataDir, "--", prompt];
}

/** The newest command list and plan usage the agent reported, each from the latest turn that had one. */
export function latestMeta(turns: TurnRecord[]): { commands: string[]; planUsage: AgentPlanUsage[]; model?: string } {
  let commands: string[] = [];
  let planUsage: AgentPlanUsage[] = [];
  let model: string | undefined;
  for (const turn of turns) {
    if (turn.meta?.commands && turn.meta.commands.length > 0) commands = turn.meta.commands;
    if (turn.meta?.planUsage && turn.meta.planUsage.length > 0) planUsage = turn.meta.planUsage;
    if (turn.meta?.model) model = turn.meta.model;
  }
  return { commands, planUsage, ...(model ? { model } : {}) };
}

const shellQuote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;

/** The command that continues the session in a terminal; absent until the agent reported its own session id. */
export function continueCommand(session: SessionRecord, agent: AgentInfo | undefined): string | undefined {
  if (!agent || !agent.capabilities.resume || session.agentSessionId === undefined) return undefined;
  return `cd ${shellQuote(session.cwd)} && ${agent.resumeCommand(session.agentSessionId)}`;
}

function agentView(a: AgentInfo): Pick<AgentInfo, "id" | "label" | "capabilities" | "profileFields"> {
  return { id: a.id, label: a.label, capabilities: a.capabilities, profileFields: a.profileFields };
}

function sessionView(item: SessionListItem): SessionListItem {
  return item;
}

/**
 * Chat sessions for the interface. Reads go through the `SessionReader` port; a turn starts by spawning `knit chat`
 * through the control spawner, so the server never writes the database. Every POST passes the security guard first.
 */
export const sessionsRoutes: RouteModule = ({ control, pollIntervalMs }) => {
  const sessions: SessionsDeps | undefined = control?.sessions;
  const pollMs = Math.min(pollIntervalMs, 100);
  /** Sessions whose turn is being started: a second request before the first one recorded its turn would start a second writer. */
  const starting = new Set<string>();

  const requireSessions = (): { control: ControlDeps; sessions: SessionsDeps } => {
    if (!control || !sessions) throw new HttpError(503, "Sessions are not available on this server");
    return { control, sessions };
  };
  const agentOf = (id: string): AgentInfo => {
    const agent = sessions?.agents.find((a) => a.id === id);
    if (!agent) throw new HttpError(404, `Agent not found: ${id}`);
    return agent;
  };
  const requireSession = (id: string): SessionRecord => {
    const session = sessions?.reader.getSession(id);
    if (!session) throw new HttpError(404, `Session not found: ${id}`);
    return session;
  };

  return [
    {
      method: "GET",
      pattern: "/api/agents",
      handler: ({ res }) => sendJson(res, 200, { agents: (sessions?.agents ?? []).map(agentView) }),
    },
    {
      method: "GET",
      pattern: "/api/agents/:agent/models",
      handler: async ({ res, params }) => {
        const agent = agentOf(params.agent!);
        let models: string[] = [];
        if (agent.capabilities.chooseModel && agent.listModels) {
          try {
            models = await agent.listModels();
          } catch {
            models = [];
          }
        }
        sendJson(res, 200, { models });
      },
    },
    {
      method: "GET",
      pattern: "/api/sessions",
      handler: ({ res }) => sendJson(res, 200, { sessions: (sessions?.reader.listSessions() ?? []).map(sessionView) }),
    },
    {
      method: "GET",
      pattern: "/api/sessions/:id",
      handler: ({ res, params }) => {
        const session = requireSession(params.id!);
        const reader = sessions!.reader;
        const turns = reader.listTurns(session.id);
        const events = reader.getEvents(session.id);
        const agent = sessions!.agents.find((a) => a.id === session.agent);
        const command = continueCommand(session, agent);
        sendJson(res, 200, {
          session,
          turns,
          meta: latestMeta(turns),
          lastEventId: events.at(-1)?.id ?? 0,
          ...(command ? { continueCommand: command } : {}),
        });
      },
    },
    {
      method: "GET",
      pattern: "/api/sessions/:id/events",
      handler: ({ res, params, url }) => {
        const session = requireSession(params.id!);
        const raw = url.searchParams.get("after") ?? "0";
        if (!/^\d+$/.test(raw)) throw new HttpError(400, "after must be a non-negative integer");
        const events: StoredSessionEvent[] = sessions!.reader.getEvents(session.id, { afterId: Number(raw), limit: MAX_EVENTS });
        sendJson(res, 200, { sessionId: session.id, events, lastEventId: events.at(-1)?.id ?? Number(raw) });
      },
    },
    {
      method: "POST",
      pattern: "/api/sessions",
      handler: async ({ req, res }) => {
        const { control: c, sessions: s } = requireSessions();
        const body = await readJsonBody(req);
        if (typeof body.agent !== "string") throw new HttpError(400, "agent must be a string");
        const agent = s.agents.find((a) => a.id === body.agent);
        if (!agent) throw new HttpError(400, `Unknown agent: ${body.agent}`);
        const { prompt, profile } = parseChatFields(body, ["agent", "cwd"], agent);
        if (typeof body.cwd !== "string" || !isAbsolute(body.cwd)) throw new HttpError(400, "cwd must be an absolute path");
        const cwd = resolve(body.cwd);
        try {
          if (!statSync(cwd).isDirectory()) throw new Error("not a directory");
        } catch {
          throw new HttpError(400, `cwd is not a directory: ${cwd}`);
        }

        const known = new Set(s.reader.listSessions().map((i) => i.session.id));
        const { child, logPath } = startChat(c, chatArgs(c, profile, prompt, ["--agent", agent.id, "--cwd", cwd]), cwd);
        let sessionId: string | undefined;
        const outcome = await awaitRegistration(
          child,
          () => {
            sessionId = s.reader.listSessions().find((i) => !known.has(i.session.id) && i.session.agent === agent.id && i.session.cwd === cwd)?.session.id;
            return sessionId !== undefined;
          },
          pollMs,
          c.registerTimeoutMs ?? DEFAULT_REGISTER_TIMEOUT_MS,
        );
        if (outcome.kind !== "found") return failRegistration(res, logPath, outcome);
        sendJson(res, 202, { sessionId, logPath });
      },
    },
    {
      method: "POST",
      pattern: "/api/sessions/:id/turns",
      handler: async ({ req, res, params }) => {
        const { control: c, sessions: s } = requireSessions();
        const body = await readJsonBody(req);
        const session = requireSession(params.id!);
        const agent = s.agents.find((a) => a.id === session.agent);
        if (!agent) throw new HttpError(409, `Session ${session.id} belongs to an agent this server does not know: ${session.agent}`);
        const { prompt, profile } = parseChatFields(body, [], agent);
        if (session.agentSessionId !== undefined && !agent.capabilities.resume) {
          throw new HttpError(409, `${agent.label} cannot resume a conversation here. Start a new session instead.`);
        }
        if (starting.has(session.id) || session.status === "running") throw new HttpError(409, `Session ${session.id} already has a turn running`);
        starting.add(session.id);
        try {
          const before = s.reader.listTurns(session.id).length;
          const { child, logPath } = startChat(c, chatArgs(c, profile, prompt, ["--session", session.id]), session.cwd);
          const outcome = await awaitRegistration(
            child,
            () => s.reader.listTurns(session.id).length > before,
            pollMs,
            c.registerTimeoutMs ?? DEFAULT_REGISTER_TIMEOUT_MS,
          );
          if (outcome.kind !== "found") return failRegistration(res, logPath, outcome);
          sendJson(res, 202, { sessionId: session.id, logPath });
        } finally {
          starting.delete(session.id);
        }
      },
    },
  ];
};

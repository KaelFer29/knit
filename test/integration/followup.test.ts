import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteRunStore } from "../../src/adapters/storage/sqlite/run-store.js";
import { SqliteSessionStore } from "../../src/adapters/storage/sqlite/session-store.js";
import { main, type CliDeps } from "../../src/cli/main.js";
import type { AgentOptions } from "../../src/cli/types.js";
import type { AgentCapabilities, AgentRunRequest, AgentRunResult, AgentRunner } from "../../src/core/ports/agent-runner.js";

const GIT_ARGS = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null"];
const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", [...GIT_ARGS, ...args], { cwd, encoding: "utf8" }).trim();

let scratch: string;
let repo: string;
let dataDir: string;
let planPath: string;

const PLAN = (repoPath: string) => `# Plan: demo plan

Repo: ${repoPath}

## T1: Create a

Branch: feat/create-a
Goal: Create src/a.txt.
Specs:
- S1: Create the file src/a.txt
Allowed files:
- src/a.txt
Checks:
- test -f src/a.txt
- grep -q a src/a.txt
`;

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s: string) => void out.push(s), err: (s: string) => void err.push(s) }, out: () => out.join(""), err: () => err.join("") };
}

const RESUMES: AgentCapabilities = { resume: true, chooseModel: true, commandList: false, visibleReasoning: true, planUsage: false };
const OK: Omit<AgentRunResult, "sessionId"> = { exitCode: 0, isError: false, resultText: "done", durationMs: 5, inputTokens: 10, outputTokens: 3, timedOut: false };

/** The agent of the original run: creates src/a.txt, commits it and reports the Cursor chat id `chat-1`. */
function runAgent(sessionId: string | null): AgentRunner {
  return {
    name: "cursor",
    run: async (req) => {
      mkdirSync(join(req.cwd, "src"), { recursive: true });
      writeFileSync(join(req.cwd, "src/a.txt"), "a\n");
      git(req.cwd, "add", "-A");
      git(req.cwd, "commit", "-q", "-m", "feat(demo): add a");
      return { ...OK, ...(sessionId !== null ? { sessionId } : {}) };
    },
  };
}

/** What the follow-up agent saw: how it was built and every request it received. */
interface Seen {
  options: AgentOptions[];
  requests: AgentRunRequest[];
}

/** An agent that obeys a marker in the prompt, as the real one obeys its instructions, inside the task worktree. */
function followupAgent(seen: Seen, capabilities: AgentCapabilities | null): AgentRunner {
  return {
    name: "cursor",
    ...(capabilities ? { capabilities } : {}),
    run: async (req, onEvent) => {
      seen.requests.push(req);
      onEvent?.({ type: "assistant", raw: { type: "assistant", message: { content: [{ type: "text", text: "On it" }] } } });
      const commit = (message: string): void => {
        git(req.cwd, "add", "-A");
        git(req.cwd, "commit", "-q", "-m", message);
      };
      if (req.prompt.includes("EDIT")) {
        writeFileSync(join(req.cwd, "src/a.txt"), `a\n${req.prompt}\n`);
        commit("feat(demo): extend a");
      } else if (req.prompt.includes("SCOPE")) {
        writeFileSync(join(req.cwd, "src/other.txt"), "x\n");
        commit("feat(demo): add other");
      } else if (req.prompt.includes("BREAK")) {
        writeFileSync(join(req.cwd, "src/a.txt"), "b\n");
        commit("feat(demo): break a");
      } else if (req.prompt.includes("THROW")) {
        throw new Error("agent exploded");
      } else if (req.prompt.includes("CRASH")) {
        return { exitCode: 3, isError: true, resultText: "bad crash", durationMs: 1, timedOut: false, sessionId: "chat-1" };
      }
      return { ...OK, resultText: "followed up", sessionId: req.resumeSessionId ?? "chat-1" };
    },
  };
}

const newSeen = (): Seen => ({ options: [], requests: [] });

function depsFor(seen: Seen, capabilities: AgentCapabilities | null = RESUMES): CliDeps {
  return {
    gitArgs: GIT_ARGS,
    cwd: scratch,
    env: { KNIT_HOME: dataDir },
    agent: (options) => {
      seen.options.push(options);
      return followupAgent(seen, capabilities);
    },
  };
}

/** Runs the plan once with an agent that finishes the task, so there is a worktree, an attempt and a chat id. */
async function runPlanFirst(sessionId: string | null = "chat-1"): Promise<string> {
  const c = capture();
  const code = await main(["run", planPath], c.io, { agent: () => runAgent(sessionId), gitArgs: GIT_ARGS, cwd: scratch, env: { KNIT_HOME: dataDir }, pullRequests: { preflight: () => {}, create: () => ({ url: "" }), status: () => ({ state: "open", base: "main" }), } });
  expect(code).toBe(0);
  const list = capture();
  await main(["runs"], list.io, { env: { KNIT_HOME: dataDir }, cwd: scratch });
  return /(demo-plan-[\w-]+)/.exec(list.out())![1]!;
}

const dbPath = (): string => join(dataDir, "knit.db");

function readRun(runId: string) {
  const store = new SqliteRunStore(dbPath());
  try {
    return { detail: store.getRun(runId)!, events: store.getEvents(runId), agentEvents: store.getAgentEvents(runId) };
  } finally {
    store.close();
  }
}

function readSessions() {
  const store = new SqliteSessionStore(dbPath());
  try {
    return store.listSessions().map((session) => ({ session, turns: store.listTurns(session.id), events: store.getEvents(session.id) }));
  } finally {
    store.close();
  }
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "orq-followup-"));
  repo = join(scratch, "target");
  dataDir = join(scratch, "data");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "hi\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "chore: init");
  planPath = join(scratch, "plan.md");
  writeFileSync(planPath, PLAN(repo));
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe("knit followup that passes", () => {
  it("resumes the task's chat in its worktree, verifies the result again and records it as the next attempt", async () => {
    const runId = await runPlanFirst();
    const before = readRun(runId).detail;
    const worktree = before.tasks[0]!.worktree!;
    const seen = newSeen();
    const c = capture();

    const code = await main(["followup", runId, "T1", "please EDIT the file"], c.io, depsFor(seen));

    expect(code, c.err()).toBe(0);
    // The agent was asked to continue chat-1 inside the worktree, with the prompt exactly as typed.
    expect(seen.requests).toHaveLength(1);
    expect(seen.requests[0]).toMatchObject({ cwd: worktree, prompt: "please EDIT the file", resumeSessionId: "chat-1" });
    expect(seen.options).toEqual([{ agent: "cursor" }]);

    // Knit verified again: the second check ran against the new content, and the outcome is attempt 2.
    const after = readRun(runId);
    const task = after.detail.tasks[0]!;
    const head = git(worktree, "rev-parse", "HEAD");
    expect(task).toMatchObject({ status: "passed", commitSha: head });
    expect(head).not.toBe(before.tasks[0]!.commitSha);
    expect(after.detail.attempts.map((a) => [a.attempt, a.status, a.sessionId])).toEqual([[1, "passed", "chat-1"], [2, "passed", "chat-1"]]);
    expect(after.detail.attempts[1]).toMatchObject({ scopeOk: true, exitCode: 0, isError: false, inputTokens: 10, outputTokens: 3, resultText: "followed up" });

    // Lifecycle events, in order, for the follow-up (attempt 2).
    const types = after.events.filter((e) => e.attempt === 2 || e.type.startsWith("followup")).map((e) => e.type);
    expect(types).toEqual(["followup.started", "attempt.started", "check.started", "check.started", "attempt.finished", "task.passed", "followup.finished"]);
    expect(after.events.find((e) => e.type === "followup.started")).toMatchObject({ taskId: "T1", attempt: 2 });
    expect(after.events.find((e) => e.type === "followup.finished")).toMatchObject({ taskId: "T1", attempt: 2, payload: { passed: true, commitSha: head } });
    // The run itself is untouched.
    expect(after.detail.run).toMatchObject({ status: "passed", planText: before.run.planText });
    expect(after.events.filter((e) => e.type === "run.finished")).toHaveLength(1);

    // The agent's timeline is part of the task's attempt 2, labelled cursor.
    const timeline = after.agentEvents.filter((e) => e.attempt === 2);
    expect(timeline.map((e) => [e.kind, e.agent])).toEqual([["message", "cursor"]]);

    // The turn is recorded through the session store: a session in the worktree that holds the attempt's chat id.
    const [only, ...rest] = readSessions();
    expect(rest).toEqual([]);
    expect(only!.session).toMatchObject({ agent: "cursor", cwd: worktree, agentSessionId: "chat-1", status: "idle" });
    expect(only!.session.title).toContain(runId);
    expect(only!.session.title).toContain("T1");
    expect(only!.turns).toHaveLength(1);
    expect(only!.turns[0]).toMatchObject({ prompt: "please EDIT the file", status: "passed", inputTokens: 10, outputTokens: 3, exitCode: 0 });
    expect(only!.events.map((e) => e.kind)).toEqual(["message"]);

    // What the user sees: the stream, the answer, the verdict and how to keep going.
    expect(c.out()).toContain("followed up");
    expect(c.out()).toMatch(/passed/);
    expect(c.out()).toContain("agent --resume chat-1");
    expect(c.out()).toContain(worktree);
  });

  it("passes --model to the agent as the turn's model", async () => {
    const runId = await runPlanFirst();
    const seen = newSeen();
    const code = await main(["followup", runId, "T1", "EDIT it", "--model", "composer-2.5-fast", "--agent-command", "my-agent"], capture().io, depsFor(seen));
    expect(code).toBe(0);
    expect(seen.options).toEqual([{ agent: "cursor", model: "composer-2.5-fast", command: "my-agent" }]);
    expect(seen.requests[0]!.profile).toEqual({ model: "composer-2.5-fast" });
    expect(readSessions()[0]!.turns[0]!.profile).toEqual({ model: "composer-2.5-fast" });
  });

  it("keeps one session for the task's chat: a second follow-up adds a turn and the next attempt number", async () => {
    const runId = await runPlanFirst();
    const seen = newSeen();
    expect(await main(["followup", runId, "T1", "EDIT once"], capture().io, depsFor(seen))).toBe(0);
    expect(await main(["followup", runId, "T1", "EDIT twice"], capture().io, depsFor(seen))).toBe(0);

    expect(readRun(runId).detail.attempts.map((a) => a.attempt)).toEqual([1, 2, 3]);
    const sessions = readSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.turns.map((t) => [t.seq, t.prompt])).toEqual([[1, "EDIT once"], [2, "EDIT twice"]]);
  });

  it("uses the chat of the latest attempt that has one", async () => {
    const runId = await runPlanFirst();
    const db = new Database(dbPath());
    db.prepare(`UPDATE attempts SET session_id = 'chat-old' WHERE run_id = ?`).run(runId);
    db.close();
    const seen = newSeen();
    expect(await main(["followup", runId, "T1", "EDIT it"], capture().io, depsFor(seen))).toBe(0);
    expect(seen.requests[0]!.resumeSessionId).toBe("chat-old");
  });

  it("goes ahead when the run is marked as running but its process is gone", async () => {
    const runId = await runPlanFirst();
    const gone = spawnSync(process.execPath, ["-e", "0"]);
    const store = new SqliteRunStore(dbPath());
    store.reopenRun(runId, gone.pid);
    store.close();
    const seen = newSeen();
    const c = capture();
    expect(await main(["followup", runId, "T1", "EDIT it"], c.io, depsFor(seen))).toBe(0);
    expect(readRun(runId).detail.run.status).toBe("running"); // the run's own state is not Knit's to change here
  });
});

describe("knit followup that fails verification", () => {
  it("fails by scope when the agent touches a file outside the task, records it and exits 1", async () => {
    const runId = await runPlanFirst();
    const c = capture();
    const code = await main(["followup", runId, "T1", "SCOPE please"], c.io, depsFor(newSeen()));

    expect(code).toBe(1);
    const { detail, events } = readRun(runId);
    expect(detail.tasks[0]!.status).toBe("failed");
    expect(detail.attempts[1]).toMatchObject({ attempt: 2, status: "failed", scopeOk: false });
    expect(events.find((e) => e.type === "followup.finished")).toMatchObject({ payload: { passed: false } });
    expect(events.find((e) => e.type === "task.failed")).toMatchObject({ taskId: "T1", payload: { reason: expect.stringContaining("src/other.txt") } });
    expect(c.out() + c.err()).toContain("src/other.txt");
    // The turn itself ran fine: only Knit's verdict failed.
    expect(readSessions()[0]!.turns[0]!.status).toBe("passed");
  });

  it("fails by a check, naming it, and keeps the previous commit sha", async () => {
    const runId = await runPlanFirst();
    const first = readRun(runId).detail.tasks[0]!.commitSha;
    const c = capture();
    const code = await main(["followup", runId, "T1", "BREAK it"], c.io, depsFor(newSeen()));

    expect(code).toBe(1);
    const { detail, events } = readRun(runId);
    expect(detail.tasks[0]).toMatchObject({ status: "failed", commitSha: first });
    expect(detail.attempts[1]).toMatchObject({ status: "failed", failedCheck: "grep -q a src/a.txt", scopeOk: true });
    expect(events.filter((e) => e.type === "check.started" && e.attempt === 2).map((e) => (e.payload as { command: string }).command)).toEqual([
      "test -f src/a.txt",
      "grep -q a src/a.txt",
    ]);
    expect(c.out() + c.err()).toContain("Check failed: grep -q a src/a.txt");
  });

  it("fails when the agent process fails, with the agent's own text, and says no files were changed otherwise", async () => {
    const runId = await runPlanFirst();
    const c = capture();
    expect(await main(["followup", runId, "T1", "CRASH now"], c.io, depsFor(newSeen()))).toBe(1);
    expect(c.out() + c.err()).toContain("bad crash");
    expect(readSessions()[0]!.turns[0]).toMatchObject({ status: "failed", exitCode: 3 });
    expect(readRun(runId).detail.attempts[1]).toMatchObject({ status: "failed", isError: true, exitCode: 3 });
  });

  it("closes the attempt as failed when the agent throws, so nothing stays open", async () => {
    const runId = await runPlanFirst();
    const c = capture();
    expect(await main(["followup", runId, "T1", "THROW now"], c.io, depsFor(newSeen()))).toBe(1);
    expect(c.out() + c.err()).toContain("agent exploded");
    const { detail, events } = readRun(runId);
    expect(detail.tasks[0]!.status).toBe("failed");
    expect(detail.attempts[1]).toMatchObject({ attempt: 2, status: "failed", isError: true });
    expect(events.filter((e) => e.attempt === 2).map((e) => e.type)).toEqual(["followup.started", "attempt.started", "attempt.finished", "task.failed", "followup.finished"]);
    expect(readSessions()[0]!.turns[0]!.status).toBe("failed");
    expect(readSessions()[0]!.session.status).toBe("idle");
  });
});

describe("knit followup that is refused", () => {
  const refused = async (args: string[], expected: RegExp, deps?: CliDeps): Promise<{ seen: Seen; err: string }> => {
    const seen = newSeen();
    const c = capture();
    const code = await main(["followup", ...args], c.io, deps ?? depsFor(seen));
    expect(code, c.out() + c.err()).toBe(1);
    expect(c.err()).toMatch(expected);
    return { seen, err: c.err() };
  };

  /** Nothing changed: no new attempt, no session, no follow-up events. */
  const untouched = (runId: string, attempts = 1): void => {
    const { detail, events } = readRun(runId);
    expect(detail.attempts).toHaveLength(attempts);
    expect(events.filter((e) => e.type.startsWith("followup"))).toEqual([]);
    expect(readSessions()).toEqual([]);
  };

  it("refuses while the run is still running (its process is alive)", async () => {
    const runId = await runPlanFirst();
    const store = new SqliteRunStore(dbPath());
    store.reopenRun(runId, process.pid);
    store.close();
    const { seen } = await refused([runId, "T1", "EDIT it"], /still running/);
    expect(seen.requests).toEqual([]);
    untouched(runId);
  });

  it("refuses when the task's worktree is gone", async () => {
    const runId = await runPlanFirst();
    rmSync(readRun(runId).detail.tasks[0]!.worktree!, { recursive: true, force: true });
    const { seen } = await refused([runId, "T1", "EDIT it"], /worktree/);
    expect(seen.requests).toEqual([]);
    untouched(runId);
  });

  it("refuses a task that has no worktree recorded", async () => {
    const runId = await runPlanFirst();
    const db = new Database(dbPath());
    db.prepare(`UPDATE tasks SET worktree = NULL WHERE run_id = ?`).run(runId);
    db.close();
    await refused([runId, "T1", "EDIT it"], /worktree/);
    untouched(runId);
  });

  it("refuses when no attempt recorded the agent's session id", async () => {
    const runId = await runPlanFirst(null);
    const { seen } = await refused([runId, "T1", "EDIT it"], /session id|chat/);
    expect(seen.requests).toEqual([]);
    untouched(runId);
  });

  it("refuses a run from before the plan snapshot existed", async () => {
    const runId = await runPlanFirst();
    const db = new Database(dbPath());
    db.prepare(`UPDATE runs SET plan_text = NULL WHERE id = ?`).run(runId);
    db.close();
    await refused([runId, "T1", "EDIT it"], /snapshot|predates/);
    untouched(runId);
  });

  it("refuses an unknown run and an unknown task", async () => {
    await refused(["nope-123", "T1", "x"], /Run not found: nope-123/);
    const runId = await runPlanFirst();
    await refused([runId, "T9", "x"], /Task not found: T9/);
    untouched(runId);
  });

  it("refuses a database that does not exist yet", async () => {
    await refused(["nope-123", "T1", "x"], /Run not found/);
    expect(existsSync(dbPath())).toBe(false);
  });

  it("refuses an agent that cannot resume, before running or recording anything", async () => {
    const runId = await runPlanFirst();
    const seen = newSeen();
    const { err } = await refused([runId, "T1", "EDIT it"], /cannot resume/, depsFor(seen, null));
    expect(err).toContain("cursor");
    expect(seen.requests).toEqual([]);
    untouched(runId);
    expect(readRun(runId).detail.tasks[0]!.status).toBe("passed");
  });

  it("refuses while another turn of the same chat is running", async () => {
    const runId = await runPlanFirst();
    const seen = newSeen();
    expect(await main(["followup", runId, "T1", "EDIT once"], capture().io, depsFor(seen))).toBe(0);
    const sessions = new SqliteSessionStore(dbPath());
    const sessionId = sessions.listSessions()[0]!.id;
    sessions.startTurn({ sessionId, prompt: "in flight", startedAt: new Date().toISOString(), pid: process.pid });
    sessions.close();
    await refused([runId, "T1", "EDIT twice"], /nother turn/);
    expect(seen.requests).toHaveLength(1);
    expect(readRun(runId).detail.attempts).toHaveLength(2);
  });
});

describe("knit followup usage", () => {
  it.each([
    [["followup"], /exactly/],
    [["followup", "run-1"], /exactly/],
    [["followup", "run-1", "T1"], /exactly/],
    [["followup", "run-1", "T1", "a", "b"], /exactly/],
    [["followup", "run-1", "T1", "   "], /prompt/],
    [["followup", "run-1", "T1", "x", "--bogus"], /bogus/],
  ])("exits 2 for %j", async (args, message) => {
    const c = capture();
    expect(await main(args, c.io, depsFor(newSeen()))).toBe(2);
    expect(c.err()).toMatch(message);
  });

  it("is described in the help", async () => {
    const c = capture();
    await main(["help"], c.io, depsFor(newSeen()));
    expect(c.err()).toContain("followup <run-id> <task-id> <prompt>");
    expect(c.err()).toContain("Options for followup");
    expect(c.err()).toContain("--model <name>");
  });
});

describe("knit followup leaves the other commands alone", () => {
  it("shows the follow-up attempt in `show` and `logs`", async () => {
    const runId = await runPlanFirst();
    expect(await main(["followup", runId, "T1", "EDIT it"], capture().io, depsFor(newSeen()))).toBe(0);
    const show = capture();
    expect(await main(["show", runId], show.io, { env: { KNIT_HOME: dataDir }, cwd: scratch })).toBe(0);
    expect(show.out()).toMatch(/2\s.*passed/);
    const logs = capture();
    expect(await main(["logs", runId], logs.io, { env: { KNIT_HOME: dataDir }, cwd: scratch })).toBe(0);
    expect(logs.out()).toContain("[T1#2]");
    expect(readFileSync(planPath, "utf8")).toBe(PLAN(repo));
  });
});

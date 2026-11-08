import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SqliteRunReader } from "../../src/adapters/storage/sqlite/run-reader.js";
import { SqliteRunStore } from "../../src/adapters/storage/sqlite/run-store.js";
import { SystemProcessControl } from "../../src/adapters/system/process-control.js";
import { knitRunMarker } from "../../src/cli/commands/abort.js";
import { knitSpawner } from "../../src/cli/commands/ui.js";
import { main } from "../../src/cli/main.js";
import type { RunReader } from "../../src/core/ports/run-reader.js";
import { lazyRunReader, startServer, type RunningServer, type SpawnRequest, type Spawner } from "../../src/server/index.js";

const GIT_ARGS = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null"];
const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", [...GIT_ARGS, ...args], { cwd, encoding: "utf8" }).trim();

const pc = new SystemProcessControl();
const ROOT = resolve(import.meta.dirname, "../..");
const BUILD = join(ROOT, "node_modules/.cache/knit-control-test");
const CLI = join(BUILD, "cli/index.js");

let scratch: string;
let repo: string;
let dataDir: string;
let planPath: string;
let agentPath: string;
let agentPidFile: string;
const spawned: ChildProcess[] = [];

/** The real CLI, compiled once: the abort tests need real `knit run` processes with real command lines. */
beforeAll(() => {
  rmSync(BUILD, { recursive: true, force: true });
  execFileSync(join(ROOT, "node_modules/.bin/tsc"), ["-p", "tsconfig.build.json", "--outDir", BUILD], { cwd: ROOT, stdio: "pipe" });
}, 120_000);

afterAll(() => {
  rmSync(BUILD, { recursive: true, force: true });
});

const PLAN = (repoPath: string) => `# Plan: slow plan

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
`;

/** A fake agent that records its pid and then never finishes on its own. */
const FAKE_AGENT = `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(process.env.FAKE_AGENT_PIDFILE, String(process.pid));
process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "s1" }) + "\\n");
setInterval(() => {}, 1000);
`;

/** Stands in for a `knit run` process that does not honour SIGINT; it also starts an agent-like child in its own group. */
const STUBBORN = `
const { spawn } = require("node:child_process");
process.on("SIGINT", () => {});
const agent = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", "stubborn-agent"], { detached: true, stdio: "ignore" });
require("node:fs").writeFileSync(process.env.STUBBORN_AGENT_PIDFILE, String(agent.pid));
setInterval(() => {}, 1000);
`;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "knit-control-"));
  repo = join(scratch, "target");
  dataDir = join(scratch, "data");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "hi\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  planPath = join(scratch, "plan.md");
  writeFileSync(planPath, PLAN(repo));
  agentPath = join(scratch, "agent.mjs");
  writeFileSync(agentPath, FAKE_AGENT);
  chmodSync(agentPath, 0o755);
  agentPidFile = join(scratch, "agent.pid");
});

afterEach(() => {
  for (const c of spawned.splice(0)) {
    for (const target of [-c.pid!, c.pid!]) {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
  const pidFiles = [agentPidFile, join(scratch, "stubborn-agent.pid")];
  for (const file of pidFiles) {
    try {
      process.kill(Number(readFileSync(file, "utf8")), "SIGKILL");
    } catch {
      /* no such file or process */
    }
  }
  rmSync(scratch, { recursive: true, force: true });
});

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s: string) => void out.push(s), err: (s: string) => void err.push(s) }, out: () => out.join(""), err: () => err.join("") };
}

async function until(check: () => boolean, ms = 15_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return check();
}

const dbPath = (): string => join(dataDir, "knit.db");

function withStore<T>(fn: (store: SqliteRunStore) => T): T {
  const store = new SqliteRunStore(dbPath());
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

const runOf = (id: string) => withStore((s) => s.getRun(id)?.run);
const eventsOf = (id: string) => withStore((s) => s.getEvents(id));

/** Starts a real `knit run` (compiled CLI) whose agent never finishes, and waits until the run is registered and the agent is up. */
async function startRealRun(): Promise<{ id: string; pid: number; agentPid: number }> {
  const child = spawn(process.execPath, [CLI, "run", planPath, "--data-dir", dataDir, "--agent-command", agentPath], {
    detached: true,
    stdio: "ignore",
    cwd: scratch,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", FAKE_AGENT_PIDFILE: agentPidFile },
  });
  spawned.push(child);
  const ready = await until(() => existsSync(agentPidFile) && existsSync(dbPath()) && withStore((s) => s.listRuns().some((r) => r.pid === child.pid)));
  expect(ready).toBe(true);
  const id = withStore((s) => s.listRuns().find((r) => r.pid === child.pid)!.id);
  return { id, pid: child.pid!, agentPid: Number(readFileSync(agentPidFile, "utf8")) };
}

/** Registers a run row as `running`, owned by `pid`. */
function seedRunning(id: string, pid: number | undefined): void {
  mkdirSync(dataDir, { recursive: true });
  withStore((s) => {
    s.createRun({ id, planName: "seed", planPath, repo, base: "main@abc12345", startedAt: "2026-11-08T10:00:00.000Z", ...(pid !== undefined ? { pid } : {}) });
  });
}

/** A process that looks like a Knit run to `knitRunMarker` (`<dir>/cli/index.js run ...`) but ignores SIGINT. */
async function startStubborn(args: string[] = ["run", "plan.md"], detached = true): Promise<{ pid: number; agentPid: number }> {
  const dir = join(scratch, "stubborn", "cli");
  mkdirSync(dir, { recursive: true });
  const entry = join(dir, "index.js");
  writeFileSync(entry, STUBBORN);
  const pidFile = join(scratch, "stubborn-agent.pid");
  const child = spawn(process.execPath, [entry, ...args], { detached, stdio: "ignore", env: { ...process.env, STUBBORN_AGENT_PIDFILE: pidFile } });
  spawned.push(child);
  expect(await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8") !== "")).toBe(true);
  return { pid: child.pid!, agentPid: Number(readFileSync(pidFile, "utf8")) };
}

function idleProcess(marker: string): ChildProcess {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", marker], { detached: true, stdio: "ignore" });
  spawned.push(child);
  return child;
}

const abort = async (...args: string[]) => {
  const c = capture();
  const code = await main(["abort", ...args, "--data-dir", dataDir], c.io, {});
  return { code, out: c.out(), err: c.err() };
};

describe("knitRunMarker", () => {
  it("accepts a run or a resume of this run and nothing else", () => {
    const m = knitRunMarker("my-run-1");
    expect(m.test("/usr/bin/node /x/dist/cli/index.js run /p/plan.md --push")).toBe(true);
    expect(m.test("/usr/bin/node /usr/local/bin/knit resume my-run-1 --pr")).toBe(true);
    expect(m.test("node /x/dist/cli/index.js resume my-run-1")).toBe(true);
    expect(m.test("node /x/dist/cli/index.js resume other-run")).toBe(false);
    expect(m.test("node /x/dist/cli/index.js resume my-run-10")).toBe(false);
    expect(m.test("node /x/dist/cli/index.js runs")).toBe(false);
    expect(m.test("node /x/dist/cli/index.js ui")).toBe(false);
    expect(m.test("node server.js run")).toBe(false);
    expect(m.test("sleep 100")).toBe(false);
  });
});

describe("knit abort", () => {
  it("stops a running run with SIGINT: the run is failed, its pid cleared and the agent gone", async () => {
    const run = await startRealRun();
    expect(pc.isAlive(run.agentPid)).toBe(true);

    const res = await abort(run.id);

    expect(res.code).toBe(0);
    expect(res.out).toContain(`Run ${run.id} aborted.`);
    expect(runOf(run.id)).toMatchObject({ status: "failed" });
    expect(runOf(run.id)?.pid).toBeUndefined();
    expect(eventsOf(run.id).filter((e) => e.type === "run.aborted")).toHaveLength(1);
    expect(await until(() => !pc.isAlive(run.pid))).toBe(true);
    expect(await until(() => !pc.isAlive(run.agentPid))).toBe(true);
  });

  it("kills the process group and the agent's group when the run ignores SIGINT past the grace period", async () => {
    const stubborn = await startStubborn();
    seedRunning("stubborn-run", stubborn.pid);
    expect(pc.processGroupOf(stubborn.pid)).toBe(stubborn.pid);

    const res = await abort("stubborn-run", "--grace-seconds", "0.3");

    expect(res.code).toBe(0);
    expect(res.out).toContain("was killed");
    expect(runOf("stubborn-run")).toMatchObject({ status: "failed" });
    expect(runOf("stubborn-run")?.pid).toBeUndefined();
    const aborted = eventsOf("stubborn-run").find((e) => e.type === "run.aborted");
    expect(aborted?.payload).toMatchObject({ reason: "killed-after-grace", pid: stubborn.pid, graceSeconds: 0.3 });
    expect(await until(() => !pc.isAlive(stubborn.pid))).toBe(true);
    expect(await until(() => !pc.isAlive(stubborn.agentPid))).toBe(true);
  });

  it("kills only the process, never the caller's group, when the run is not a group leader", async () => {
    const stubborn = await startStubborn(["run", "plan.md"], false);
    seedRunning("member-run", stubborn.pid);
    expect(pc.processGroupOf(stubborn.pid)).toBe(pc.processGroupOf(process.pid));

    const res = await abort("member-run", "--grace-seconds", "0.3");

    // Reaching this line at all proves the test runner's own group survived.
    expect(res.code).toBe(0);
    expect(runOf("member-run")).toMatchObject({ status: "failed" });
    expect(await until(() => !pc.isAlive(stubborn.pid))).toBe(true);
    expect(await until(() => !pc.isAlive(stubborn.agentPid))).toBe(true);
  });

  it("marks a run failed when its process was killed with SIGKILL (stale pid)", async () => {
    const run = await startRealRun();
    process.kill(run.pid, "SIGKILL");
    expect(await until(() => !pc.isAlive(run.pid))).toBe(true);
    expect(runOf(run.id)).toMatchObject({ status: "running", pid: run.pid });

    const res = await abort(run.id);

    expect(res.code).toBe(0);
    expect(res.out).toContain("is gone");
    expect(runOf(run.id)).toMatchObject({ status: "failed" });
    expect(runOf(run.id)?.pid).toBeUndefined();
    expect(eventsOf(run.id).find((e) => e.type === "run.aborted")?.payload).toEqual({ reason: "stale-pid", pid: run.pid });
  });

  it("refuses a pid that is alive but is not a Knit process, and signals nothing", async () => {
    const stranger = idleProcess("not-knit-at-all");
    seedRunning("recycled-run", stranger.pid);

    const res = await abort("recycled-run", "--grace-seconds", "0.2");

    expect(res.code).toBe(1);
    expect(res.err).toContain("not a Knit process");
    expect(pc.isAlive(stranger.pid!)).toBe(true);
    expect(stranger.signalCode).toBeNull();
    expect(runOf("recycled-run")).toMatchObject({ status: "running", pid: stranger.pid });
    expect(eventsOf("recycled-run").some((e) => e.type === "run.aborted")).toBe(false);
  });

  it("refuses a Knit process that resumes a different run", async () => {
    const other = await startStubborn(["resume", "some-other-run"]);
    seedRunning("my-run", other.pid);

    const res = await abort("my-run", "--grace-seconds", "0.2");

    expect(res.code).toBe(1);
    expect(res.err).toContain("not a Knit process for run my-run");
    expect(pc.isAlive(other.pid)).toBe(true);
    expect(runOf("my-run")).toMatchObject({ status: "running" });
  });

  it("refuses when two running runs claim the same pid", async () => {
    const stubborn = await startStubborn();
    seedRunning("claim-a", stubborn.pid);
    seedRunning("claim-b", stubborn.pid);

    const res = await abort("claim-a", "--grace-seconds", "0.2");

    expect(res.code).toBe(1);
    expect(res.err).toContain("more than one running run");
    expect(pc.isAlive(stubborn.pid)).toBe(true);
    expect(runOf("claim-a")).toMatchObject({ status: "running" });
    expect(runOf("claim-b")).toMatchObject({ status: "running" });
  });

  it("refuses a running run that has no recorded pid, and changes nothing", async () => {
    seedRunning("legacy-run", undefined);

    const res = await abort("legacy-run");

    expect(res.code).toBe(1);
    expect(res.err).toContain("no recorded process");
    expect(runOf("legacy-run")).toMatchObject({ status: "running" });
    expect(eventsOf("legacy-run")).toEqual([]);
  });

  it("reports an unknown run with exit 1", async () => {
    seedRunning("exists", undefined);
    const res = await abort("nope-123");
    expect(res.code).toBe(1);
    expect(res.err).toContain("Run not found: nope-123");
  });

  it("reports a missing database as run not found with exit 1", async () => {
    const res = await abort("nope-123");
    expect(res.code).toBe(1);
    expect(res.err).toContain("Run not found: nope-123");
    expect(existsSync(dbPath())).toBe(false);
  });

  it("succeeds without touching a run that already finished", async () => {
    seedRunning("done-run", 4242);
    withStore((s) => s.finishRun("done-run", "passed", "2026-11-08T10:05:00.000Z"));

    const res = await abort("done-run");

    expect(res.code).toBe(0);
    expect(res.out).toContain("already finished (passed)");
    expect(runOf("done-run")).toMatchObject({ status: "passed", finishedAt: "2026-11-08T10:05:00.000Z" });
    expect(eventsOf("done-run")).toEqual([]);
  });

  it("fails with a usage error for a missing run id or a bad grace period", async () => {
    const none = capture();
    expect(await main(["abort"], none.io, {})).toBe(2);
    expect(none.err()).toContain("abort needs exactly one run id");
    const bad = capture();
    expect(await main(["abort", "r1", "--grace-seconds", "0"], bad.io, {})).toBe(2);
    expect(bad.err()).toContain("--grace-seconds must be a positive number");
    const unknown = capture();
    expect(await main(["abort", "r1", "--force"], unknown.io, {})).toBe(2);
  });

  it("is listed in the help text", async () => {
    const help = capture();
    await main(["help"], help.io, {});
    expect(help.err()).toContain("abort <run-id>");
    expect(help.err()).toContain("--grace-seconds <n>");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Run control over real HTTP
// ---------------------------------------------------------------------------------------------------------------

const servers: RunningServer[] = [];
const readers: RunReader[] = [];
const spawnCalls: SpawnRequest[] = [];

afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  for (const r of readers.splice(0)) r.close();
  spawnCalls.length = 0;
});

async function launch(spawn: Spawner | undefined, registerTimeoutMs = 10_000): Promise<RunningServer> {
  const reader = lazyRunReader(() => (existsSync(dbPath()) ? new SqliteRunReader(dbPath()) : undefined));
  readers.push(reader);
  const server = await startServer({
    reader,
    port: 0,
    staticDir: join(scratch, "no-web"),
    pollIntervalMs: 20,
    statusIntervalMs: 40,
    heartbeatMs: 60,
    ...(spawn ? { control: { dataDir, spawn, registerTimeoutMs } } : {}),
  });
  servers.push(server);
  return server;
}

/** Records every request and answers with a pid that never registers a run. */
const recordingSpawner = (): Spawner => (request) => {
  spawnCalls.push(request);
  return { pid: idleProcess("recording").pid, exited: new Promise(() => {}) };
};

const realSpawner = (): Spawner =>
  knitSpawner({
    entry: CLI,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", FAKE_AGENT_PIDFILE: agentPidFile, KNIT_UI_TOKEN: "must-not-leak" },
    runArgs: ["--agent-command", agentPath],
  });

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  json: () => any;
}

interface PostOptions {
  body?: string | object;
  headers?: http.OutgoingHttpHeaders;
  auth?: boolean;
  origin?: string | null;
  contentType?: string | null;
}

/** Real HTTP with full control of the headers (fetch cannot set Host or Origin). */
function post(server: RunningServer, path: string, { body = {}, headers = {}, auth = true, origin, contentType = "application/json" }: PostOptions = {}): Promise<Reply> {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const host = `127.0.0.1:${server.port}`;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: server.port,
        method: "POST",
        path,
        headers: {
          host,
          ...(auth ? { authorization: `Bearer ${server.token}` } : {}),
          ...(origin === null ? {} : { origin: origin ?? `http://${host}` }),
          ...(contentType === null ? {} : { "content-type": contentType }),
          "content-length": Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, headers: res.headers, json: () => JSON.parse(text) });
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

function get(server: RunningServer, path: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: server.port, path, headers: { host: `127.0.0.1:${server.port}`, authorization: `Bearer ${server.token}` } }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, json: () => JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
      })
      .on("error", reject);
  });
}

/** Adds a task to a seeded run. */
function seedTask(runId: string, taskId: string, status: "pending" | "running" | "passed" | "failed"): void {
  withStore((s) => s.upsertTask({ runId, taskId, title: `Task ${taskId}`, status, position: Number(taskId.slice(1)) }));
}

function seedFinished(id: string, status: "passed" | "failed" = "failed"): void {
  seedRunning(id, undefined);
  withStore((s) => s.finishRun(id, status, "2026-11-08T10:05:00.000Z"));
}

/** A spawner standing in for `knit resume`: it reopens the run for an idle process, like the real command does first thing. */
const resumingSpawner = (delayMs = 0): Spawner => (request) => {
  spawnCalls.push(request);
  const owner = idleProcess("resume-stand-in");
  const reopen = (): void => withStore((s) => s.reopenRun(request.args[1]!, owner.pid));
  if (delayMs > 0) setTimeout(reopen, delayMs);
  else reopen();
  return { pid: owner.pid, exited: new Promise(() => {}) };
};

describe("control routes: security", () => {
  const routes = ["/api/runs", "/api/runs/r1/abort", "/api/runs/r1/resume", "/api/runs/r1/tasks/T1/retry"];

  beforeEach(() => {
    seedRunning("r1", undefined);
    seedTask("r1", "T1", "failed");
  });

  it.each(routes)("rejects %s without a token", async (path) => {
    const server = await launch(recordingSpawner());
    const res = await post(server, path, { auth: false });
    expect(res.status).toBe(401);
    expect(spawnCalls).toEqual([]);
  });

  it.each(routes)("rejects %s with a wrong Origin", async (path) => {
    const server = await launch(recordingSpawner());
    const res = await post(server, path, { origin: "http://evil.example" });
    expect(res.status).toBe(403);
    expect(spawnCalls).toEqual([]);
  });

  it.each(routes)("rejects %s without an Origin", async (path) => {
    const server = await launch(recordingSpawner());
    const res = await post(server, path, { origin: null });
    expect(res.status).toBe(403);
    expect(spawnCalls).toEqual([]);
  });

  it.each(routes)("rejects %s with a wrong Host", async (path) => {
    const server = await launch(recordingSpawner());
    const res = await post(server, path, { headers: { host: "evil.example" } });
    expect(res.status).toBe(403);
    expect(spawnCalls).toEqual([]);
  });

  it.each(routes)("rejects %s with another content type or none", async (path) => {
    const server = await launch(recordingSpawner());
    expect((await post(server, path, { contentType: "text/plain" })).status).toBe(415);
    expect((await post(server, path, { contentType: "application/x-www-form-urlencoded", body: "a=b" })).status).toBe(415);
    expect((await post(server, path, { contentType: null })).status).toBe(415);
    expect(spawnCalls).toEqual([]);
  });

  it.each(routes)("rejects %s with a body over 64 KB", async (path) => {
    const server = await launch(recordingSpawner());
    const res = await post(server, path, { body: JSON.stringify({ planPath: "x".repeat(70_000) }) });
    expect(res.status).toBe(413);
    expect(spawnCalls).toEqual([]);
  });

  it.each(routes)("rejects %s with a body that is not a JSON object", async (path) => {
    const server = await launch(recordingSpawner());
    expect((await post(server, path, { body: "{not json" })).status).toBe(400);
    expect((await post(server, path, { body: "[1,2]" })).status).toBe(400);
    expect(spawnCalls).toEqual([]);
  });

  it("answers 503 on every control route when the server has no run control", async () => {
    const server = await launch(undefined);
    for (const path of routes) expect((await post(server, path)).status).toBe(503);
  });

  it("answers 405 to a GET on a control route and keeps the read routes working", async () => {
    const server = await launch(recordingSpawner());
    expect((await get(server, "/api/runs/r1/abort")).status).toBe(405);
    expect((await get(server, "/api/runs")).status).toBe(200);
  });
});

describe("POST /api/runs validation", () => {
  const plan = (name: string, text: string): string => {
    const path = join(scratch, name);
    writeFileSync(path, text);
    return path;
  };

  it("lists every issue of a plan that does not parse, with a 400", async () => {
    const server = await launch(recordingSpawner());
    const bad = plan("bad.md", "# Plan: broken\n\n## T1: no branch no goal\n");
    const res = await post(server, "/api/runs", { body: { planPath: bad } });
    expect(res.status).toBe(400);
    const body = res.json();
    expect(body.issues.length).toBeGreaterThanOrEqual(2);
    expect(body.error).toContain("Invalid plan");
    expect(spawnCalls).toEqual([]);
  });

  it.each([
    ["a relative path", () => ({ planPath: "plan.md" }), "absolute"],
    ["a missing planPath", () => ({}), "planPath"],
    ["a non-string planPath", () => ({ planPath: 7 }), "planPath"],
    ["a file that is not .md", () => ({ planPath: plan("plan.txt", PLAN(repo)) }), ".md"],
    ["a missing file", () => ({ planPath: join(scratch, "missing.md") }), "Cannot read"],
    ["a directory", () => ({ planPath: join(scratch, "dir.md") }), "regular file"],
    ["a plan over 1 MB", () => ({ planPath: plan("big.md", PLAN(repo) + "x".repeat(1024 * 1024)) }), "larger"],
    ["push that is not a boolean", () => ({ planPath, push: "yes" }), "push"],
    ["pr that is not a boolean", () => ({ planPath, pr: 1 }), "pr"],
    ["maxAttempts of 0", () => ({ planPath, maxAttempts: 0 }), "maxAttempts"],
    ["maxAttempts of 2.5", () => ({ planPath, maxAttempts: 2.5 }), "maxAttempts"],
    ["maxAttempts over the limit", () => ({ planPath, maxAttempts: 21 }), "maxAttempts"],
    ["an unknown field", () => ({ planPath, agentCommand: "rm" }), "Unknown field"],
  ])("rejects %s with a 400 and starts nothing", async (_name, body, message) => {
    const server = await launch(recordingSpawner());
    mkdirSync(join(scratch, "dir.md"), { recursive: true });
    const res = await post(server, "/api/runs", { body: body() });
    expect(res.status).toBe(400);
    expect(res.json().error).toContain(message);
    expect(spawnCalls).toEqual([]);
  });

  it("passes the options and the data directory to knit run, in the plan's directory, with a log file", async () => {
    const server = await launch(recordingSpawner(), 300);
    const res = await post(server, "/api/runs", { body: { planPath, push: true, pr: true, maxAttempts: 3 } });
    expect(res.status).toBe(504);
    expect(spawnCalls).toHaveLength(1);
    const call = spawnCalls[0]!;
    expect(call.args).toEqual(["run", planPath, "--push", "--pr", "--max-attempts", "3", "--data-dir", dataDir]);
    expect(call.cwd).toBe(scratch);
    expect(call.logFile.startsWith(join(dataDir, "logs", "_ui") + "/run-")).toBe(true);
    expect(res.json().logPath).toBe(call.logFile);
  });

  it("answers 502 with the exit code when the child dies before registering a run", async () => {
    const server = await launch(() => ({ pid: 999_999, exited: Promise.resolve(3) }));
    const res = await post(server, "/api/runs", { body: { planPath } });
    expect(res.status).toBe(502);
    expect(res.json().error).toContain("exited (code 3)");
    expect(res.json().logPath).toContain("/logs/_ui/run-");
  });

  it("answers 502 when the process cannot be started", async () => {
    const server = await launch(() => ({ pid: undefined, exited: Promise.resolve(null) }));
    const res = await post(server, "/api/runs", { body: { planPath } });
    expect(res.status).toBe(502);
  });

  it("answers 502 when the spawner throws", async () => {
    const server = await launch(() => {
      throw new Error("EMFILE");
    });
    const res = await post(server, "/api/runs", { body: { planPath } });
    expect(res.status).toBe(502);
    expect(res.json().error).toContain("EMFILE");
  });
});

describe("abort, resume and retry routes", () => {
  it("abort: 404 for an unknown run, 409 for one that is not running, 202 and `knit abort` for a running one", async () => {
    const server = await launch(recordingSpawner());
    seedFinished("done-run");
    seedRunning("live-run", 4242);

    expect((await post(server, "/api/runs/nope/abort")).status).toBe(404);
    expect((await post(server, "/api/runs/done-run/abort")).status).toBe(409);
    expect(spawnCalls).toEqual([]);

    const ok = await post(server, "/api/runs/live-run/abort");
    expect(ok.status).toBe(202);
    expect(ok.json().runId).toBe("live-run");
    expect(spawnCalls.map((c) => c.args)).toEqual([["abort", "live-run", "--data-dir", dataDir]]);
    expect(spawnCalls[0]!.logFile).toContain("/logs/_ui/abort-");
  });

  it("abort: answers 502 when the process cannot be started", async () => {
    const server = await launch(() => ({ pid: undefined, exited: Promise.resolve(null) }));
    seedRunning("live-run", 4242);
    expect((await post(server, "/api/runs/live-run/abort")).status).toBe(502);
  });

  it("resume: 404 for an unknown run, 409 for a running one, 202 and `knit resume` for a failed one", async () => {
    const server = await launch(resumingSpawner());
    seedFinished("failed-run");
    seedRunning("live-run", 4242);

    expect((await post(server, "/api/runs/nope/resume")).status).toBe(404);
    expect((await post(server, "/api/runs/live-run/resume")).status).toBe(409);
    expect(spawnCalls).toEqual([]);

    const ok = await post(server, "/api/runs/failed-run/resume");
    expect(ok.status).toBe(202);
    expect(ok.json()).toMatchObject({ runId: "failed-run" });
    expect(spawnCalls.map((c) => c.args)).toEqual([["resume", "failed-run", "--data-dir", dataDir]]);
    expect(runOf("failed-run")).toMatchObject({ status: "running" });
  });

  it("resume: also accepts a run that was aborted", async () => {
    const server = await launch(resumingSpawner());
    seedRunning("aborted-run", 4242);
    withStore((s) => {
      s.finishRun("aborted-run", "failed", "2026-11-08T10:05:00.000Z");
      s.recordEvent({ runId: "aborted-run", ts: "2026-11-08T10:05:00.000Z", type: "run.aborted" });
    });
    expect((await post(server, "/api/runs/aborted-run/resume")).status).toBe(202);
  });

  it("resume: a second request while the first is waiting for the run to start is a 409 and starts nothing", async () => {
    const server = await launch(resumingSpawner(400));
    seedFinished("failed-run");
    const [first, second] = await Promise.all([
      post(server, "/api/runs/failed-run/resume"),
      new Promise<Reply>((resolve) => setTimeout(() => void post(server, "/api/runs/failed-run/resume").then(resolve), 100)),
    ]);
    expect(first.status).toBe(202);
    expect(second.status).toBe(409);
    expect(spawnCalls).toHaveLength(1);
  });

  it("resume: 504 with the log path when the run never takes the process over", async () => {
    const server = await launch(recordingSpawner(), 300);
    seedFinished("failed-run");
    const res = await post(server, "/api/runs/failed-run/resume");
    expect(res.status).toBe(504);
    expect(res.json().logPath).toContain("/logs/_ui/resume-");
  });

  it("resume: 502 when the child exits without taking the run over", async () => {
    const server = await launch(() => ({ pid: 999_999, exited: Promise.resolve(1) }));
    seedFinished("failed-run");
    const res = await post(server, "/api/runs/failed-run/resume");
    expect(res.status).toBe(502);
    expect(runOf("failed-run")).toMatchObject({ status: "failed" });
  });

  it("retry: 404 for an unknown run or task, 409 for a task that is not failed or a run that is running", async () => {
    const server = await launch(resumingSpawner());
    seedFinished("failed-run");
    seedTask("failed-run", "T1", "passed");
    seedTask("failed-run", "T2", "failed");
    seedTask("failed-run", "T3", "pending");
    seedRunning("live-run", 4242);
    seedTask("live-run", "T1", "failed");

    expect((await post(server, "/api/runs/nope/tasks/T1/retry")).status).toBe(404);
    expect((await post(server, "/api/runs/failed-run/tasks/T9/retry")).status).toBe(404);
    expect((await post(server, "/api/runs/failed-run/tasks/T1/retry")).status).toBe(409);
    expect((await post(server, "/api/runs/failed-run/tasks/T3/retry")).status).toBe(409);
    expect((await post(server, "/api/runs/live-run/tasks/T1/retry")).status).toBe(409);
    expect(spawnCalls).toEqual([]);
  });

  it("retry: resumes the run when the task failed", async () => {
    const server = await launch(resumingSpawner());
    seedFinished("failed-run");
    seedTask("failed-run", "T1", "passed");
    seedTask("failed-run", "T2", "failed");

    const res = await post(server, "/api/runs/failed-run/tasks/T2/retry");

    expect(res.status).toBe(202);
    expect(spawnCalls.map((c) => c.args)).toEqual([["resume", "failed-run", "--data-dir", dataDir]]);
  });
});

describe("knitSpawner", () => {
  it("starts a detached child in its own group, with no token in its environment, logging to the file", async () => {
    const out = join(scratch, "env.json");
    const entry = join(scratch, "dump.js");
    writeFileSync(
      entry,
      `require("node:fs").writeFileSync(process.argv[2], JSON.stringify({ env: process.env, args: process.argv.slice(3), pid: process.pid }));
       console.log("hello from the child"); console.error("and stderr");`,
    );
    const logFile = join(scratch, "logs", "_ui", "x.log");
    const spawner = knitSpawner({ entry, env: { PATH: process.env.PATH, KNIT_UI_TOKEN: "secret", KNIT_TOKEN: "secret", KEEP: "1" } });

    const child = spawner({ args: [out, "a", "b"], cwd: scratch, logFile });

    expect(await child.exited).toBe(0);
    const seen = JSON.parse(readFileSync(out, "utf8"));
    expect(seen.args).toEqual(["a", "b"]);
    expect(seen.env.KEEP).toBe("1");
    expect(seen.env.KNIT_UI_TOKEN).toBeUndefined();
    expect(seen.env.KNIT_TOKEN).toBeUndefined();
    expect(seen.pid).toBe(child.pid);
    expect(readFileSync(logFile, "utf8")).toContain("hello from the child");
    expect(readFileSync(logFile, "utf8")).toContain("and stderr");
  });

  it("puts the child in its own process group", async () => {
    const entry = join(scratch, "idle.js");
    writeFileSync(entry, "setInterval(()=>{},1000)");
    const child = knitSpawner({ entry, env: {} })({ args: ["x"], logFile: join(scratch, "i.log") });
    spawned.push({ pid: child.pid } as ChildProcess);
    expect(pc.processGroupOf(child.pid!)).toBe(child.pid);
  });

  it("adds the run options to run and resume only", async () => {
    const out = join(scratch, "args.json");
    const entry = join(scratch, "args.js");
    writeFileSync(entry, `require("node:fs").writeFileSync("${out}", JSON.stringify(process.argv.slice(2)));`);
    const spawner = knitSpawner({ entry, env: {}, runArgs: ["--agent-command", "fake"] });
    await spawner({ args: ["run", "p.md"], logFile: join(scratch, "a.log") }).exited;
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual(["run", "p.md", "--agent-command", "fake"]);
    await spawner({ args: ["abort", "r1"], logFile: join(scratch, "b.log") }).exited;
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual(["abort", "r1"]);
  });
});

describe("run control end to end (real processes)", () => {
  it("starts a run from a plan, aborts it, and resumes it, through the routes", async () => {
    const server = await launch(realSpawner());

    // Start.
    const started = await post(server, "/api/runs", { body: { planPath } });
    expect(started.status).toBe(202);
    const { runId, pid, logPath } = started.json();
    spawned.push({ pid } as ChildProcess);
    expect(pc.isAlive(pid)).toBe(true);
    expect(existsSync(logPath)).toBe(true);
    expect(logPath.startsWith(join(dataDir, "logs", "_ui"))).toBe(true);
    expect(pc.processGroupOf(pid)).toBe(pid);
    expect(pc.commandLine(pid)).toEqual(expect.arrayContaining([CLI, "run", planPath, "--data-dir", dataDir]));
    expect(runOf(runId)).toMatchObject({ status: "running", pid });
    expect(pc.commandLine(pid)!.join(" ")).not.toContain(server.token);
    expect(readFileSync(`/proc/${pid}/environ`, "utf8")).not.toContain("must-not-leak");
    expect(await until(() => existsSync(agentPidFile))).toBe(true);
    const agentPid = Number(readFileSync(agentPidFile, "utf8"));

    // Abort.
    const aborted = await post(server, `/api/runs/${runId}/abort`);
    expect(aborted.status).toBe(202);
    expect(await until(() => runOf(runId)?.status === "failed")).toBe(true);
    expect(runOf(runId)?.pid).toBeUndefined();
    expect(eventsOf(runId).some((e) => e.type === "run.aborted")).toBe(true);
    expect(await until(() => !pc.isAlive(pid))).toBe(true);
    expect(await until(() => !pc.isAlive(agentPid))).toBe(true);
    // The read side shows the same.
    expect((await get(server, `/api/runs/${runId}`)).json().run.status).toBe("failed");

    // Resume: a new process takes the run over.
    rmSync(agentPidFile, { force: true });
    const resumed = await post(server, `/api/runs/${runId}/resume`);
    expect(resumed.status).toBe(202);
    const resumedPid = resumed.json().pid as number;
    spawned.push({ pid: resumedPid } as ChildProcess);
    expect(resumedPid).not.toBe(pid);
    expect(runOf(runId)).toMatchObject({ status: "running", pid: resumedPid });
    expect(pc.commandLine(resumedPid)).toEqual(expect.arrayContaining([CLI, "resume", runId]));

    // A second resume while it runs is refused.
    expect((await post(server, `/api/runs/${runId}/resume`)).status).toBe(409);

    // And it can be aborted again.
    expect((await post(server, `/api/runs/${runId}/abort`)).status).toBe(202);
    expect(await until(() => runOf(runId)?.status === "failed")).toBe(true);
    expect(await until(() => !pc.isAlive(resumedPid))).toBe(true);
  });
});

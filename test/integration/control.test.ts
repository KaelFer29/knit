import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SqliteRunStore } from "../../src/adapters/storage/sqlite/run-store.js";
import { SystemProcessControl } from "../../src/adapters/system/process-control.js";
import { knitRunMarker } from "../../src/cli/commands/abort.js";
import { main } from "../../src/cli/main.js";

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

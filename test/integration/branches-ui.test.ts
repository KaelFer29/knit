import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteRunReader } from "../../src/adapters/storage/sqlite/run-reader.js";
import { SqliteRunStore } from "../../src/adapters/storage/sqlite/run-store.js";
import type { PullRequests } from "../../src/core/ports/pull-requests.js";
import { GitBranchTools } from "../../src/adapters/vcs/git/git-branch-tools.js";
import { lazyRunReader, startServer, type RunningServer, type SpawnRequest, type Spawner } from "../../src/server/index.js";

const GIT_ARGS = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null"];
const git = (cwd: string, ...args: string[]): string => execFileSync("git", [...GIT_ARGS, ...args], { cwd, encoding: "utf8" }).trim();

let scratch: string;
let repo: string;
let dataDir: string;
let worktree: string;
let startSha: string;
const servers: RunningServer[] = [];
const calls: SpawnRequest[] = [];
/** What the fake `knit branch` child answers, and whether it ever finishes. */
let answer: { json?: object; code?: number; hang?: boolean } = {};

const RUN = "demo-plan-20260101-000000";
const dbPath = (): string => join(dataDir, "knit.db");

/** A run that passed, with one task whose branch and worktree are real. */
function seed(status: "passed" | "running" = "passed", extraTask = false): void {
  worktree = join(dataDir, "worktrees", RUN, "T1", "repo");
  mkdirSync(join(worktree, ".."), { recursive: true });
  git(repo, "worktree", "add", "-q", "-b", "docs/one", worktree, startSha);
  writeFileSync(join(worktree, "prueba.md"), "hello world\n");
  git(worktree, "add", "-A");
  git(worktree, "commit", "-qm", "docs: add prueba.md");
  const store = new SqliteRunStore(dbPath());
  store.createRun({ id: RUN, planName: "demo plan", planPath: join(scratch, "plan.md"), repo, base: "main@" + startSha.slice(0, 8), startedAt: "2026-01-01T00:00:00.000Z" });
  store.upsertTask({ runId: RUN, taskId: "T1", title: "Create prueba.md", status: "passed", branch: "docs/one", worktree, startSha, position: 1 });
  if (extraTask) store.upsertTask({ runId: RUN, taskId: "T2", title: "No branch yet", status: "pending", position: 2 });
  if (status === "passed") store.finishRun(RUN, "passed", "2026-01-01T00:01:00.000Z");
  store.close();
}

const spawner: Spawner = (request) => {
  calls.push(request);
  if (answer.hang) return { pid: 4242, exited: new Promise(() => {}) };
  mkdirSync(dirname(request.logFile), { recursive: true });
  writeFileSync(request.logFile, answer.json === undefined ? "something went wrong\n" : `noise first\n${JSON.stringify(answer.json)}\n`);
  return { pid: 4242, exited: Promise.resolve(answer.code ?? 0) };
};

async function launch(opts: { control?: boolean; branches?: boolean; timeoutMs?: number; pulls?: PullRequests } = {}): Promise<RunningServer> {
  const reader = lazyRunReader(() => new SqliteRunReader(dbPath()));
  const server = await startServer({
    reader,
    port: 0,
    staticDir: join(scratch, "no-web"),
    ...(opts.branches === false ? {} : { branches: new GitBranchTools({ gitArgs: GIT_ARGS }) }),
    ...(opts.pulls ? { pullRequests: opts.pulls } : {}),
    ...(opts.control === false ? {} : { control: { dataDir, spawn: spawner, ...(opts.timeoutMs ? { actionTimeoutMs: opts.timeoutMs } : {}) } }),
  });
  servers.push(server);
  return server;
}

interface Reply {
  status: number;
  json: () => any;
}

function request(server: RunningServer, method: "GET" | "POST", path: string, body: unknown = {}, auth = true): Promise<Reply> {
  const payload = method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : "";
  const host = `127.0.0.1:${server.port}`;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: server.port,
        method,
        path,
        headers: { host, ...(auth ? { authorization: `Bearer ${server.token}` } : {}), ...(method === "POST" ? { origin: `http://${host}`, "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: () => JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
      },
    );
    req.on("error", reject);
    req.end(method === "POST" ? payload : undefined);
  });
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "knit-branches-ui-"));
  repo = join(scratch, "target");
  dataDir = join(scratch, "data");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "hi\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "chore: init");
  startSha = git(repo, "rev-parse", "HEAD");
  calls.length = 0;
  answer = {};
});
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("GET /api/runs/:id/branches", () => {
  it("lists each task that has a branch with its state, what each undo would do and whether a pull request can be opened", async () => {
    seed("passed", true);
    const body = (await request(await launch(), "GET", `/api/runs/${RUN}/branches`)).json();
    expect(body).toMatchObject({ runId: RUN, runStatus: "passed", base: "main" });
    expect(body.branches).toHaveLength(1);
    const [b] = body.branches;
    expect(b).toMatchObject({ taskId: "T1", title: "Create prueba.md", branch: "docs/one", status: "passed", state: { exists: true, pushed: false, hasWorktree: true, dirty: false, historyIntact: true } });
    expect(b.state.ahead.map((c: any) => c.subject)).toEqual(["docs: add prueba.md"]);
    for (const mode of ["revert", "reset", "delete"]) expect(b.undo[mode]).toMatchObject({ ok: true, effects: expect.any(Array) });
    expect(b.pr).toMatchObject({ ok: true, base: "main", head: "docs/one" });
  });

  it("refuses every action while the run is running, with the reason", async () => {
    seed("running");
    const [b] = (await request(await launch(), "GET", `/api/runs/${RUN}/branches`)).json().branches;
    for (const mode of ["revert", "reset", "delete"]) expect(b.undo[mode]).toEqual({ ok: false, reason: "The run is still running. Abort it first." });
    expect(b.pr.ok).toBe(false);
  });

  it("shows the pull request a task already has, and offers no second one", async () => {
    seed();
    const store = new SqliteRunStore(dbPath());
    store.upsertTask({ runId: RUN, taskId: "T1", title: "Create prueba.md", status: "passed", prUrl: "https://example.test/pull/7" });
    store.close();
    const [b] = (await request(await launch(), "GET", `/api/runs/${RUN}/branches`)).json().branches;
    expect(b.prUrl).toBe("https://example.test/pull/7");
    expect(b.pr).toMatchObject({ ok: false, reason: expect.stringContaining("already has a pull request") });
  });

  it("answers 404 for an unknown run, 503 without the inspector and 401 without the token", async () => {
    seed();
    expect((await request(await launch(), "GET", "/api/runs/nope/branches")).status).toBe(404);
    expect((await request(await launch({ branches: false }), "GET", `/api/runs/${RUN}/branches`)).status).toBe(503);
    expect((await request(await launch(), "GET", `/api/runs/${RUN}/branches`, {}, false)).status).toBe(401);
  });
});

describe("POST /api/runs/:id/tasks/:task/undo", () => {
  const url = `/api/runs/${RUN}/tasks/T1/undo`;

  it("runs knit branch undo with the mode, confirmed, and returns what it answered", async () => {
    seed();
    answer = { json: { ok: true, dryRun: false, mode: "revert", branch: "docs/one", effects: ["Adds one commit"], sha: "abc" } };
    const reply = await request(await launch(), "POST", url, { mode: "revert", confirm: true });
    expect(reply.status).toBe(200);
    expect(reply.json()).toMatchObject({ ok: true, mode: "revert", sha: "abc" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(["branch", RUN, "T1", "undo", "--mode", "revert", "--yes", "--json", "--data-dir", dataDir]);
  });

  it("answers 409 with the reason when the command refuses", async () => {
    seed();
    answer = { json: { ok: false, reason: "The run is still running. Abort it first." }, code: 1 };
    const reply = await request(await launch(), "POST", url, { mode: "delete", confirm: true });
    expect(reply.status).toBe(409);
    expect(reply.json()).toEqual({ error: "The run is still running. Abort it first." });
  });

  it("does nothing without an explicit confirmation, for an unknown mode, an unknown field or an unknown task", async () => {
    seed();
    const server = await launch();
    expect((await request(server, "POST", url, { mode: "revert" })).status).toBe(400);
    expect((await request(server, "POST", url, { mode: "revert", confirm: "yes" })).status).toBe(400);
    expect((await request(server, "POST", url, { mode: "explode", confirm: true })).status).toBe(400);
    expect((await request(server, "POST", url, { mode: "revert", confirm: true, force: true })).status).toBe(400);
    expect((await request(server, "POST", `/api/runs/${RUN}/tasks/T9/undo`, { mode: "revert", confirm: true })).status).toBe(404);
    expect((await request(server, "POST", `/api/runs/nope/tasks/T1/undo`, { mode: "revert", confirm: true })).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("answers 502 when the command leaves no answer, 503 without run control and 401 without the token", async () => {
    seed();
    answer = { code: 1 };
    expect((await request(await launch(), "POST", url, { mode: "revert", confirm: true })).status).toBe(502);
    expect((await request(await launch({ control: false }), "POST", url, { mode: "revert", confirm: true })).status).toBe(503);
    expect((await request(await launch(), "POST", url, { mode: "revert", confirm: true }, false)).status).toBe(401);
  });

  it("does not start a second action on the same task while one is running, and answers 504 when it takes too long", async () => {
    seed();
    answer = { hang: true };
    const server = await launch({ timeoutMs: 300 });
    const first = request(server, "POST", url, { mode: "revert", confirm: true });
    await new Promise((r) => setTimeout(r, 100));
    expect((await request(server, "POST", url, { mode: "reset", confirm: true })).status).toBe(409);
    expect((await first).status).toBe(504);
    // The child may still be running, so the task stays locked: a second action must not overlap it.
    expect((await request(server, "POST", url, { mode: "reset", confirm: true })).status).toBe(409);
    expect(calls).toHaveLength(1);
  });
});

describe("POST /api/runs/:id/tasks/:task/pr-draft and /pr", () => {
  const draft = `/api/runs/${RUN}/tasks/T1/pr-draft`;
  const pr = `/api/runs/${RUN}/tasks/T1/pr`;

  it("asks for a draft, with the default model unless one is given", async () => {
    seed();
    answer = { json: { ok: true, title: "Add prueba.md", body: "- adds it", model: "composer-2.5-fast" } };
    const server = await launch();
    const reply = await request(server, "POST", draft, {});
    expect(reply.status).toBe(200);
    expect(reply.json()).toMatchObject({ ok: true, title: "Add prueba.md" });
    expect(calls[0]!.args).toEqual(["branch", RUN, "T1", "pr-draft", "--json", "--data-dir", dataDir]);
    await request(server, "POST", draft, { model: "grok-4.7-high" });
    expect(calls[1]!.args).toEqual(["branch", RUN, "T1", "pr-draft", "--model", "grok-4.7-high", "--json", "--data-dir", dataDir]);
  });

  it("rejects a model that could be read as a flag or has spaces", async () => {
    seed();
    const server = await launch();
    for (const model of ["--force", "a b", "", 5]) expect((await request(server, "POST", draft, { model })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("starts the checkout of a branch only when it is confirmed, and says what it did", async () => {
    seed();
    answer = { json: { ok: true, dryRun: false, branch: "docs/one", effects: ["Switches your repository to docs/one."], freedWorktree: true } };
    const server = await launch();
    const url = `/api/runs/${RUN}/tasks/T1/checkout`;
    expect((await request(server, "POST", url, {})).status).toBe(400);
    expect((await request(server, "POST", url, { confirm: false })).status).toBe(400);
    expect((await request(server, "POST", url, { confirm: true, extra: 1 })).status).toBe(400);
    expect(calls).toHaveLength(0);
    const reply = await request(server, "POST", url, { confirm: true });
    expect(reply.status).toBe(200);
    expect(reply.json()).toMatchObject({ ok: true, branch: "docs/one", freedWorktree: true });
    expect(calls[0]!.args).toEqual(["branch", RUN, "T1", "checkout", "--yes", "--json", "--data-dir", dataDir]);
  });

  it("lists the branches origin has, for choosing where a pull request goes", async () => {
    seed();
    const bare = join(scratch, "origin.git");
    git(scratch, "init", "-q", "--bare", bare);
    git(repo, "remote", "add", "origin", bare);
    git(repo, "push", "-q", "origin", "main", "docs/one");
    const server = await launch();
    const reply = await request(server, "GET", `/api/runs/${RUN}/remote-branches`);
    expect(reply.status).toBe(200);
    expect(reply.json()).toEqual({ branches: ["docs/one", "main"] });
    expect((await request(server, "GET", `/api/runs/${RUN}/remote-branches`, {}, false)).status).toBe(401);
    expect((await request(server, "GET", "/api/runs/nope/remote-branches")).status).toBe(404);
    expect((await request(await launch({ branches: false }), "GET", `/api/runs/${RUN}/remote-branches`)).status).toBe(503);
  });

  it("explains why the branches of origin cannot be listed when there is no origin", async () => {
    seed();
    const reply = await request(await launch(), "GET", `/api/runs/${RUN}/remote-branches`);
    expect(reply.status).toBe(502);
    expect(reply.json().error).toMatch(/origin/i);
  });

  it("asks for the description built from the task, with no model, when template is true, and refuses anything else", async () => {
    seed();
    answer = { json: { ok: true, title: "Create prueba.md", body: "## Summary", model: "template" } };
    const server = await launch();
    expect((await request(server, "POST", draft, { template: true })).status).toBe(200);
    expect(calls[0]!.args).toEqual(["branch", RUN, "T1", "pr-draft", "--template", "--json", "--data-dir", dataDir]);
    const before = calls.length;
    for (const body of [{ template: "yes" }, { template: false }, { template: true, model: "grok-4.7-high" }]) expect((await request(server, "POST", draft, body)).status, JSON.stringify(body)).toBe(400);
    expect(calls).toHaveLength(before);
  });

  it("opens the pull request with the title and body exactly as given, and returns its address", async () => {
    seed();
    answer = { json: { ok: true, url: "https://example.test/pull/7", base: "main", head: "docs/one" } };
    const reply = await request(await launch(), "POST", pr, { title: "Add prueba.md", body: "## Summary\n- adds it; `rm -rf /` stays text" });
    expect(reply.status).toBe(200);
    expect(reply.json()).toMatchObject({ ok: true, url: "https://example.test/pull/7" });
    expect(calls[0]!.args).toEqual(["branch", RUN, "T1", "pr", "--title=Add prueba.md", "--body=## Summary\n- adds it; `rm -rf /` stays text", "--json", "--data-dir", dataDir]);
  });

  it("passes the branch to open the pull request into as one argument, and refuses what is not a branch name", async () => {
    seed();
    answer = { json: { ok: true, url: "https://example.test/pull/7", base: "release/1.2", head: "docs/one" } };
    const server = await launch();
    expect((await request(server, "POST", pr, { title: "t", body: "b", base: "release/1.2" })).status).toBe(200);
    expect(calls[0]!.args).toEqual(["branch", RUN, "T1", "pr", "--title=t", "--body=b", "--base=release/1.2", "--json", "--data-dir", dataDir]);
    const before = calls.length;
    for (const base of ["--force", "a b", 7, ""]) expect((await request(server, "POST", pr, { title: "t", body: "b", base })).status, String(base)).toBe(400);
    expect(calls).toHaveLength(before);
  });

  it("passes a title or a body that starts with a dash as one argument, so the command does not read it as an option", async () => {
    seed();
    answer = { json: { ok: true, url: "https://example.test/pull/7", base: "main", head: "docs/one" } };
    await request(await launch(), "POST", pr, { title: "-fix the typo", body: "- adds the file\n--yes is only text" });
    expect(calls[0]!.args).toContain("--title=-fix the typo");
    expect(calls[0]!.args).toContain("--body=- adds the file\n--yes is only text");
    expect(calls[0]!.args).not.toContain("--yes");
  });

  it("answers 409 with the reason when the command refuses", async () => {
    seed();
    answer = { json: { ok: false, reason: "GitHub CLI is not logged in. Run: gh auth login" }, code: 1 };
    const reply = await request(await launch(), "POST", pr, { title: "t", body: "b" });
    expect(reply.status).toBe(409);
    expect(reply.json().error).toContain("not logged in");
  });

  it("rejects a missing or oversized title or body, a title with a line break and unknown fields, running nothing", async () => {
    seed();
    const server = await launch();
    for (const body of [{ title: "t" }, { body: "b" }, { title: "a\nb", body: "b" }, { title: "x".repeat(201), body: "b" }, { title: "t", body: "b".repeat(60_001) }, { title: "t", body: "b", draft: true }, { title: 5, body: "b" }]) {
      expect((await request(server, "POST", pr, body)).status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });
});

describe("GET /api/runs/:id/branches with a pull request", () => {
  const PR = "https://github.com/acme/demo/pull/7";
  const pulls = (state: "open" | "merged" | "closed", base = "main"): PullRequests => ({
    preflight: () => {},
    create: () => ({ url: PR }),
    status: () => ({ state, base }),
  });

  it("says whether the pull request is open or merged, and into which branch", async () => {
    seed();
    const store = new SqliteRunStore(dbPath());
    store.upsertTask({ runId: RUN, taskId: "T1", title: "Create prueba.md", status: "passed", branch: "docs/one", worktree, startSha, position: 1, prUrl: PR });
    store.close();
    const reply = await request(await launch({ pulls: pulls("merged", "release/1.2") }), "GET", `/api/runs/${RUN}/branches`);
    expect(reply.status).toBe(200);
    expect(reply.json().branches[0]).toMatchObject({ prUrl: PR, prState: { state: "merged", base: "release/1.2" } });
  });

  describe("a branch that got new commits after its pull request", () => {
    const seedWithPr = (): string => {
      seed();
      const store = new SqliteRunStore(dbPath());
      store.upsertTask({ runId: RUN, taskId: "T1", title: "Create prueba.md", status: "passed", branch: "docs/one", worktree, startSha, position: 1, prUrl: PR });
      store.close();
      return git(repo, "rev-parse", "docs/one");
    };
    const endedAt = (headSha: string, state: "open" | "merged" | "closed" = "merged"): PullRequests => ({ preflight: () => {}, create: () => ({ url: PR }), status: () => ({ state, base: "main", headSha }) });
    const addCommit = (): void => {
      writeFileSync(join(worktree, "second.md"), "second\n");
      git(worktree, "add", "-A");
      git(worktree, "commit", "-qm", "docs: correct prueba.md");
    };

    it("says how many commits the merged pull request did not carry, and lets another be opened", async () => {
      const merged = seedWithPr();
      addCommit();
      const b = (await request(await launch({ pulls: endedAt(merged) }), "GET", `/api/runs/${RUN}/branches`)).json().branches[0];
      expect(b.prState).toMatchObject({ state: "merged", base: "main", newCommits: 1 });
      expect(b.pr).toMatchObject({ ok: true, head: "docs/one" });
    });

    it("keeps refusing a second pull request when the merged one carried everything", async () => {
      const merged = seedWithPr();
      const b = (await request(await launch({ pulls: endedAt(merged) }), "GET", `/api/runs/${RUN}/branches`)).json().branches[0];
      expect(b.prState).toMatchObject({ state: "merged", newCommits: 0 });
      expect(b.pr).toMatchObject({ ok: false, reason: expect.stringContaining("already has a pull request") });
    });

    it("does not count while the pull request is still open", async () => {
      const head = seedWithPr();
      addCommit();
      const b = (await request(await launch({ pulls: endedAt(head, "open") }), "GET", `/api/runs/${RUN}/branches`)).json().branches[0];
      expect(b.prState.newCommits).toBeUndefined();
      expect(b.pr.ok).toBe(false);
    });
  });

  it("still lists the branch when GitHub cannot be asked: no state, the address kept", async () => {
    seed();
    const store = new SqliteRunStore(dbPath());
    store.upsertTask({ runId: RUN, taskId: "T1", title: "Create prueba.md", status: "passed", branch: "docs/one", worktree, startSha, position: 1, prUrl: PR });
    store.close();
    const broken: PullRequests = { preflight: () => {}, create: () => ({ url: PR }), status: () => { throw new Error("no network"); } };
    const reply = await request(await launch({ pulls: broken }), "GET", `/api/runs/${RUN}/branches`);
    expect(reply.status).toBe(200);
    expect(reply.json().branches[0].prUrl).toBe(PR);
    expect(reply.json().branches[0].prState).toBeUndefined();
  });
});

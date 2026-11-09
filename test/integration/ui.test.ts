import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteRunReader } from "../../src/adapters/storage/sqlite/run-reader.js";
import { SqliteRunStore } from "../../src/adapters/storage/sqlite/run-store.js";
import { main } from "../../src/cli/main.js";
import type { RunReader } from "../../src/core/ports/run-reader.js";
import { startServer, type RunningServer, type ServerOptions } from "../../src/server/index.js";

const RUN = {
  id: "run-1",
  planName: "demo",
  planPath: "/p/plan.md",
  repo: "/r",
  base: "main@abc12345",
  startedAt: "2026-11-08T10:00:00.000Z",
};
const ts = "2026-11-08T10:01:00.000Z";

let dir: string;
let dbPath: string;
let store: SqliteRunStore;
let readers: RunReader[];
let servers: RunningServer[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "knit-ui-"));
  dbPath = join(dir, "knit.db");
  store = new SqliteRunStore(dbPath);
  readers = [];
  servers = [];
});

afterEach(async () => {
  for (const s of servers) await s.close();
  for (const r of readers) r.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function seedRun(): void {
  store.createRun({ ...RUN, pid: 1 });
  store.upsertTask({ runId: "run-1", taskId: "T1", title: "First", status: "running", position: 1 });
  store.upsertTask({ runId: "run-1", taskId: "T2", title: "Second", status: "pending", position: 2 });
  store.recordEvent({ runId: "run-1", taskId: "T1", attempt: 1, ts, type: "attempt.started" });
  store.recordAgentEvent({ runId: "run-1", taskId: "T1", attempt: 1, ts, kind: "message", payload: { text: "hello" } });
}

async function launch(options: Partial<ServerOptions> = {}, reader?: RunReader): Promise<RunningServer> {
  const r = reader ?? new SqliteRunReader(dbPath);
  readers.push(r);
  const server = await startServer({
    reader: r,
    port: 0,
    staticDir: join(dir, "no-web"),
    pollIntervalMs: 20,
    statusIntervalMs: 40,
    heartbeatMs: 60,
    ...options,
  });
  servers.push(server);
  return server;
}

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: () => any;
}

/** Real HTTP with full control of the headers (fetch cannot set Host or Origin). */
function request(
  server: RunningServer,
  path: string,
  { method = "GET", headers = {}, auth = true }: { method?: string; headers?: http.OutgoingHttpHeaders; auth?: boolean } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: server.port,
        method,
        path,
        headers: {
          host: `127.0.0.1:${server.port}`,
          ...(auth ? { authorization: `Bearer ${server.token}` } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json: () => JSON.parse(body) });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

interface Frame {
  id?: string;
  event?: string;
  data?: any;
}

/** A minimal SSE client: collects frames and comments as they arrive. */
function openSse(server: RunningServer, path: string, headers: http.OutgoingHttpHeaders = {}, auth = true) {
  const frames: Frame[] = [];
  const comments: string[] = [];
  let ended = false;
  let buffer = "";
  let status = 0;
  let responseHeaders: http.IncomingHttpHeaders = {};
  let req!: http.ClientRequest;
  const ready = new Promise<void>((resolve, reject) => {
    req = http.request(
      {
        host: "127.0.0.1",
        port: server.port,
        path,
        headers: { host: `127.0.0.1:${server.port}`, ...(auth ? { authorization: `Bearer ${server.token}` } : {}), ...headers },
      },
      (res) => {
        status = res.statusCode ?? 0;
        responseHeaders = res.headers;
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          let at: number;
          while ((at = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, at);
            buffer = buffer.slice(at + 2);
            const frame: Frame = {};
            for (const line of block.split("\n")) {
              if (line.startsWith(":")) comments.push(line);
              else if (line.startsWith("id: ")) frame.id = line.slice(4);
              else if (line.startsWith("event: ")) frame.event = line.slice(7);
              else if (line.startsWith("data: ")) frame.data = JSON.parse(line.slice(6));
            }
            if (frame.event) frames.push(frame);
          }
        });
        res.on("end", () => (ended = true));
        res.on("close", () => (ended = true));
        resolve();
      },
    );
    req.on("error", reject);
    req.end();
  });
  return {
    ready,
    frames,
    comments,
    get status() {
      return status;
    },
    get headers() {
      return responseHeaders;
    },
    get ended() {
      return ended;
    },
    close: () => req.destroy(),
  };
}

async function until(predicate: () => boolean, what: string, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("HTTP API", () => {
  it("lists runs, newest first, with task counts", async () => {
    seedRun();
    store.createRun({ ...RUN, id: "run-2", startedAt: "2026-11-08T11:00:00.000Z" });
    const server = await launch();

    const res = await request(server, "/api/runs");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["cache-control"]).toBe("no-store");
    const { runs } = res.json();
    expect(runs.map((r: any) => r.run.id)).toEqual(["run-2", "run-1"]);
    expect(runs[1].taskCounts).toMatchObject({ total: 2, running: 1, pending: 1 });
  });

  it("returns the snapshot of a run with its board", async () => {
    seedRun();
    const server = await launch();

    const res = await request(server, "/api/runs/run-1");

    expect(res.status).toBe(200);
    const body = res.json();
    expect(body.run).toMatchObject({ id: "run-1", status: "running" });
    expect(body.tasks.map((t: any) => t.taskId)).toEqual(["T1", "T2"]);
    expect(body.lastEventId).toBeGreaterThan(0);
    expect(body.lastAgentEventId).toBeGreaterThan(0);
    expect(body.board.tasks.map((t: any) => [t.taskId, t.state])).toEqual([
      ["T1", "running"],
      ["T2", "queued"],
    ]);
    expect(body.board.active).toMatchObject({ taskId: "T1" });
    expect(body.board.liveLine).toMatchObject({ source: "cursor", text: "hello" });
  });

  it("returns the timeline of one attempt", async () => {
    seedRun();
    store.recordAgentEvent({ runId: "run-1", taskId: "T1", attempt: 2, ts, kind: "message", payload: { text: "later" } });
    store.recordAgentEvent({ runId: "run-1", taskId: "T2", attempt: 1, ts, kind: "message", payload: { text: "other" } });
    const server = await launch();

    const res = await request(server, "/api/runs/run-1/tasks/T1/attempts/1/timeline");

    expect(res.status).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ runId: "run-1", taskId: "T1", attempt: 1 });
    expect(body.events.map((e: any) => e.payload.text)).toEqual(["hello"]);
    const empty = await request(server, "/api/runs/run-1/tasks/T1/attempts/7/timeline");
    expect(empty.json().events).toEqual([]);
  });

  it("answers 404 with a JSON error for unknown ids and routes, and 400 for malformed requests", async () => {
    seedRun();
    const server = await launch();

    for (const path of [
      "/api/runs/nope",
      "/api/runs/nope/stream",
      "/api/runs/nope/tasks/T1/attempts/1/timeline",
      "/api/runs/run-1/tasks/T9/attempts/1/timeline",
      "/api/unknown",
    ]) {
      const res = await request(server, path);
      expect(res.status, path).toBe(404);
      expect(res.headers["content-type"]).toContain("application/json");
      expect(res.json().error, path).toEqual(expect.any(String));
    }
    for (const path of [
      "/api/runs/run-1/tasks/T1/attempts/x/timeline",
      "/api/runs/run-1/tasks/T1/attempts/-1/timeline",
      "/api/runs/%E0%A4%A",
      "/api/runs/run-1/stream?after=garbage",
    ]) {
      const res = await request(server, path);
      expect(res.status, path).toBe(400);
      expect(res.json().error, path).toEqual(expect.any(String));
    }
  });

  it("answers 405 with Allow for a known path with another method", async () => {
    const server = await launch();
    const res = await request(server, "/api/runs", { method: "POST", headers: { origin: `http://127.0.0.1:${server.port}` } });
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe("GET");
  });
});

describe("security", () => {
  it("binds to 127.0.0.1 only", async () => {
    const server = await launch();
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/?token=${server.token}`);
    expect(server.token).toMatch(/^[0-9a-f]{64}$/);
    const second = await launch();
    expect(second.token).not.toBe(server.token);
  });

  it("rejects a request without a token, or with a wrong one, on every kind of route", async () => {
    seedRun();
    const server = await launch();
    const wrong = "0".repeat(64);

    for (const path of ["/api/runs", "/api/runs/run-1", "/api/runs/run-1/stream", "/api/nope", "/", "/assets/app.js"]) {
      const none = await request(server, path, { auth: false });
      expect(none.status, `none ${path}`).toBe(401);
      const bad = await request(server, path, { auth: false, headers: { authorization: `Bearer ${wrong}` } });
      expect(bad.status, `bad ${path}`).toBe(401);
      const cookie = await request(server, path, { auth: false, headers: { cookie: `knit_token=${wrong}` } });
      expect(cookie.status, `cookie ${path}`).toBe(401);
    }
    const queryOnly = await request(server, `/api/runs?token=${wrong}`, { auth: false });
    expect(queryOnly.status).toBe(401);
    expect(queryOnly.headers["set-cookie"]).toBeUndefined();
    const nonBearer = await request(server, "/api/runs", { auth: false, headers: { authorization: `Basic ${server.token}` } });
    expect(nonBearer.status).toBe(401);
    // The error never echoes the token.
    expect((await request(server, "/api/runs", { auth: false })).body).not.toContain(server.token);
  });

  it("ignores a token in the query of a request that is not a GET", async () => {
    const server = await launch();
    const res = await request(server, `/api/runs?token=${server.token}`, {
      method: "POST",
      auth: false,
      headers: { origin: `http://127.0.0.1:${server.port}` },
    });
    expect(res.status).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("turns ?token= into an HttpOnly SameSite=Strict cookie and redirects to the clean URL", async () => {
    seedRun();
    const server = await launch();

    const first = await request(server, `/?token=${server.token}`, { auth: false });

    expect(first.status).toBe(302);
    expect(first.headers.location).toBe("/");
    const cookie = String(first.headers["set-cookie"]);
    expect(cookie).toContain(`knit_token=${server.token}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    const next = await request(server, "/api/runs", { auth: false, headers: { cookie: cookie.split(";")[0]! } });
    expect(next.status).toBe(200);
    const sse = openSse(server, "/api/runs/run-1/stream", { cookie: cookie.split(";")[0]! }, false);
    await sse.ready;
    expect(sse.status).toBe(200);
    sse.close();
  });

  it("keeps the rest of the query when it removes the token, and never redirects off the origin", async () => {
    const server = await launch();
    const a = await request(server, `/api/runs?x=1&token=${server.token}&y=2`, { auth: false });
    expect(a.headers.location).toBe("/api/runs?x=1&y=2");
    const b = await request(server, `//evil.example/?token=${server.token}`, { auth: false });
    expect(b.status).toBe(302);
    expect(b.headers.location).toBe("/evil.example/");
  });

  it("rejects a Host other than 127.0.0.1:<port> or localhost:<port> (DNS rebinding), even with a valid token", async () => {
    const server = await launch();
    for (const host of ["evil.example", `evil.example:${server.port}`, "127.0.0.1", `127.0.0.1:${server.port + 1}`, `localhost.evil.example:${server.port}`]) {
      const res = await request(server, "/api/runs", { headers: { host } });
      expect(res.status, host).toBe(403);
    }
    const viaQuery = await request(server, `/?token=${server.token}`, { auth: false, headers: { host: "evil.example" } });
    expect(viaQuery.status).toBe(403);
    expect(viaQuery.headers["set-cookie"]).toBeUndefined();
    const localhost = await request(server, "/api/runs", { headers: { host: `localhost:${server.port}` } });
    expect(localhost.status).toBe(200);
  });

  it("requires an Origin equal to the server's own on mutating methods", async () => {
    const server = await launch();
    const own = `http://127.0.0.1:${server.port}`;
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const none = await request(server, "/api/runs", { method });
      expect(none.status, `${method} without origin`).toBe(403);
      for (const origin of ["http://evil.example", `http://127.0.0.1:${server.port + 1}`, `https://127.0.0.1:${server.port}`, "null"]) {
        const cross = await request(server, "/api/runs", { method, headers: { origin } });
        expect(cross.status, `${method} from ${origin}`).toBe(403);
      }
      // Same origin passes the guard and reaches routing (this route is GET-only).
      const ok = await request(server, "/api/runs", { method, headers: { origin: own } });
      expect(ok.status, `${method} same origin`).toBe(405);
    }
    // A cross-origin request without a token is rejected for the token first.
    const noToken = await request(server, "/api/runs", { method: "POST", auth: false, headers: { origin: "http://evil.example" } });
    expect(noToken.status).toBe(401);
    // GET does not need an Origin.
    expect((await request(server, "/api/runs")).status).toBe(200);
  });

  it("sends security headers and no CORS headers", async () => {
    seedRun();
    const server = await launch();
    const replies = [
      await request(server, "/api/runs"),
      await request(server, "/"),
      await request(server, "/api/nope"),
      await request(server, "/api/runs", { auth: false }),
    ];
    for (const res of replies) {
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
      expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
      expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(Object.keys(res.headers).filter((h) => h.startsWith("access-control-"))).toEqual([]);
    }
    expect(replies[0]!.headers["cache-control"]).toBe("no-store");
    const preflight = await request(server, "/api/runs", { method: "OPTIONS", headers: { origin: "http://evil.example" } });
    expect(Object.keys(preflight.headers).filter((h) => h.startsWith("access-control-"))).toEqual([]);
    expect(preflight.status).toBeGreaterThanOrEqual(400);
    const sse = openSse(server, "/api/runs/run-1/stream");
    await sse.ready;
    expect(sse.headers["x-content-type-options"]).toBe("nosniff");
    expect(sse.headers["cache-control"]).toBe("no-store");
    sse.close();
  });

  it("never serves anything outside the static directory", async () => {
    const web = join(dir, "web");
    mkdirSync(web);
    writeFileSync(join(web, "index.html"), "<p>app</p>");
    writeFileSync(join(dir, "secret.txt"), "TOP-SECRET");
    symlinkSync(join(dir, "secret.txt"), join(web, "link.txt"));
    const server = await launch({ staticDir: web });

    for (const path of [
      "/..%2fsecret.txt",
      "/%2e%2e%2fsecret.txt",
      "/..%2f..%2f..%2f..%2fetc%2fpasswd",
      "/%2e%2e/secret.txt",
      "/assets/..%2f..%2fsecret.txt",
      "/%00",
      "/..%5csecret.txt",
      "/link.txt",
    ]) {
      const res = await request(server, path);
      expect(res.body, path).not.toContain("TOP-SECRET");
      expect(res.body, path).not.toContain("root:");
      expect([400, 403, 404], path).toContain(res.status);
    }
    // A raw `..` is resolved by URL parsing before it reaches the file system.
    const raw = await request(server, "/../secret.txt");
    expect(raw.body).not.toContain("TOP-SECRET");
  });
});

describe("static files", () => {
  it("serves the built app with SPA fallback", async () => {
    const web = join(dir, "web");
    mkdirSync(join(web, "assets"), { recursive: true });
    writeFileSync(join(web, "index.html"), "<p>app</p>");
    writeFileSync(join(web, "assets", "app.js"), "console.log(1)");
    writeFileSync(join(web, "assets", "app.css"), "body{}");
    const server = await launch({ staticDir: web });

    const index = await request(server, "/");
    expect(index.status).toBe(200);
    expect(index.body).toBe("<p>app</p>");
    expect(index.headers["content-type"]).toBe("text/html; charset=utf-8");
    const js = await request(server, "/assets/app.js");
    expect(js.body).toBe("console.log(1)");
    expect(js.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect((await request(server, "/assets/app.css")).headers["content-type"]).toBe("text/css; charset=utf-8");
    const spa = await request(server, "/runs/run-1");
    expect(spa.status).toBe(200);
    expect(spa.body).toBe("<p>app</p>");
    expect((await request(server, "/assets/missing.js")).status).toBe(404);
    const head = await request(server, "/", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
    // The unknown API routes are not swallowed by the fallback.
    expect((await request(server, "/api/missing")).status).toBe(404);
  });

  it("serves a built-in page when the interface is not built", async () => {
    const server = await launch({ staticDir: join(dir, "does-not-exist") });

    const res = await request(server, "/");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.body).toContain("pnpm build");
    expect((await request(server, "/runs/run-1")).body).toContain("pnpm build");
  });
});

describe("live stream (SSE)", () => {
  it("replays the rows that exist and delivers rows written after the connection, with composite ids", async () => {
    seedRun();
    const server = await launch();
    const sse = openSse(server, "/api/runs/run-1/stream");
    await sse.ready;
    expect(sse.status).toBe(200);
    expect(sse.headers["content-type"]).toContain("text/event-stream");

    await until(() => sse.frames.length >= 2, "the existing rows");
    expect(sse.frames.map((f) => f.event)).toEqual(["event", "agent_event"]);
    expect(sse.frames[0]!.data).toMatchObject({ type: "attempt.started", taskId: "T1" });
    expect(sse.frames[1]!.data).toMatchObject({ kind: "message", payload: { text: "hello" } });

    store.recordAgentEvent({ runId: "run-1", taskId: "T1", attempt: 1, ts, kind: "message", payload: { text: "second" } });
    store.recordEvent({ runId: "run-1", taskId: "T1", attempt: 1, ts, type: "check.started" });
    await until(() => sse.frames.length >= 4, "rows written after connecting");

    const texts = sse.frames.map((f) => f.data.payload?.text ?? f.data.type);
    expect(texts).toEqual(["attempt.started", "hello", "check.started", "second"]);
    // Rows of other runs never leak in.
    store.createRun({ ...RUN, id: "other" });
    store.recordEvent({ runId: "other", ts, type: "run.started" });
    await new Promise((r) => setTimeout(r, 100));
    expect(sse.frames).toHaveLength(4);
    for (const f of sse.frames) expect(f.id).toMatch(/^\d+\.\d+$/);
    sse.close();
  });

  it("resumes from Last-Event-ID without gaps or duplicates", async () => {
    seedRun();
    for (let i = 0; i < 5; i++) {
      store.recordAgentEvent({ runId: "run-1", taskId: "T1", attempt: 1, ts, kind: "message", payload: { text: `m${i}` } });
      store.recordEvent({ runId: "run-1", taskId: "T1", attempt: 1, ts, type: `e${i}` });
    }
    const server = await launch();
    const all = openSse(server, "/api/runs/run-1/stream");
    await all.ready;
    await until(() => all.frames.length >= 12, "the whole history");
    all.close();
    const seen = (f: Frame) => `${f.event}:${f.data.id}`;
    const everything = all.frames.map(seen);
    expect(new Set(everything).size).toBe(everything.length);

    // Drop the connection in the middle, then reconnect with the id of every possible cut.
    for (const cut of [0, 1, 5, 6, 11]) {
      const last = all.frames[cut]!.id!;
      const resumed = openSse(server, "/api/runs/run-1/stream", { "last-event-id": last });
      await resumed.ready;
      await until(() => resumed.frames.length >= everything.length - cut - 1, `resume after frame ${cut}`);
      await new Promise((r) => setTimeout(r, 80));
      expect([...all.frames.slice(0, cut + 1).map(seen), ...resumed.frames.map(seen)], `cut ${cut}`).toEqual(everything);
      resumed.close();
    }

    // A row written while disconnected arrives exactly once on reconnection.
    const last = all.frames.at(-1)!.id!;
    store.recordAgentEvent({ runId: "run-1", taskId: "T1", attempt: 1, ts, kind: "message", payload: { text: "while away" } });
    const back = openSse(server, "/api/runs/run-1/stream", { "last-event-id": last });
    await back.ready;
    await until(() => back.frames.length >= 1, "the missed row");
    await new Promise((r) => setTimeout(r, 80));
    expect(back.frames.map((f) => f.data.payload.text)).toEqual(["while away"]);
    back.close();
  });

  it("starts from ?after= on a first connection, and the header wins over it", async () => {
    seedRun();
    const server = await launch();
    const snapshot = (await request(server, "/api/runs/run-1")).json();
    const after = `${snapshot.lastEventId}.${snapshot.lastAgentEventId}`;
    const sse = openSse(server, `/api/runs/run-1/stream?after=${after}`);
    await sse.ready;
    store.recordAgentEvent({ runId: "run-1", taskId: "T1", attempt: 1, ts, kind: "message", payload: { text: "new" } });
    await until(() => sse.frames.length >= 1, "the new row");
    await new Promise((r) => setTimeout(r, 80));
    expect(sse.frames.map((f) => f.data.payload.text)).toEqual(["new"]);
    sse.close();

    const header = openSse(server, `/api/runs/run-1/stream?after=${after}`, { "last-event-id": "0.0" });
    await header.ready;
    await until(() => header.frames.length >= 3, "the replay from the header");
    header.close();
  });

  it("sends heartbeat comments", async () => {
    seedRun();
    const server = await launch();
    const sse = openSse(server, "/api/runs/run-1/stream");
    await sse.ready;
    await until(() => sse.comments.filter((c) => c === ": ping").length >= 2, "heartbeats");
    sse.close();
  });

  it("sends a final message and ends when the run is no longer running", async () => {
    seedRun();
    const server = await launch();
    const sse = openSse(server, "/api/runs/run-1/stream");
    await sse.ready;
    await until(() => sse.frames.length >= 2, "the existing rows");
    expect(sse.ended).toBe(false);

    store.recordEvent({ runId: "run-1", ts, type: "run.finished", payload: { status: "passed" } });
    store.finishRun("run-1", "passed", ts);

    await until(() => sse.ended, "the stream to end");
    const names = sse.frames.map((f) => f.event);
    expect(names.at(-1)).toBe("done");
    expect(sse.frames.at(-1)!.data).toEqual({ status: "passed" });
    // The row written just before the run finished was delivered first.
    expect(names.filter((n) => n === "event")).toHaveLength(2);
  });

  it("replays a finished run completely, then ends", async () => {
    seedRun();
    store.finishRun("run-1", "failed", ts);
    const server = await launch();
    const sse = openSse(server, "/api/runs/run-1/stream");
    await sse.ready;
    await until(() => sse.ended, "the stream to end");
    expect(sse.frames.map((f) => f.event)).toEqual(["event", "agent_event", "done"]);
    expect(sse.frames.at(-1)!.data).toEqual({ status: "failed" });
  });

  it("stops polling when the client disconnects", async () => {
    seedRun();
    let polls = 0;
    const inner = new SqliteRunReader(dbPath);
    const counting: RunReader = {
      ...inner,
      listRuns: () => inner.listRuns(),
      getRunSnapshot: (id) => inner.getRunSnapshot(id),
      getEventsAfter: (...args) => {
        polls++;
        return inner.getEventsAfter(...args);
      },
      getAgentEventsAfter: (...args) => inner.getAgentEventsAfter(...args),
      close: () => inner.close(),
    };
    const server = await launch({}, counting);
    const sse = openSse(server, "/api/runs/run-1/stream");
    await sse.ready;
    await until(() => polls >= 3, "a few polls");

    sse.close();
    await new Promise((r) => setTimeout(r, 100));
    const settled = polls;
    await new Promise((r) => setTimeout(r, 200));

    expect(polls).toBe(settled);
  });

  it("keeps streaming when a poll fails and recovers on the next one", async () => {
    seedRun();
    const inner = new SqliteRunReader(dbPath);
    let fail = 2;
    const flaky: RunReader = {
      listRuns: () => inner.listRuns(),
      getRunSnapshot: (id) => inner.getRunSnapshot(id),
      getEventsAfter: (...args) => {
        if (fail-- > 0) throw new Error("database is locked");
        return inner.getEventsAfter(...args);
      },
      getAgentEventsAfter: (...args) => inner.getAgentEventsAfter(...args),
      close: () => inner.close(),
    };
    const server = await launch({}, flaky);
    const sse = openSse(server, "/api/runs/run-1/stream");
    await sse.ready;
    await until(() => sse.frames.length >= 2, "rows after the failed polls");
    sse.close();
  });
});

describe("knit ui", () => {
  function capture() {
    const out: string[] = [];
    const err: string[] = [];
    return { io: { out: (s: string) => void out.push(s), err: (s: string) => void err.push(s) }, out, err };
  }

  async function startUi(args: string[]) {
    const { io, out, err } = capture();
    const stop = new AbortController();
    const done = main(["ui", ...args], io, { stopSignal: stop.signal, env: { HOME: dir } });
    await until(() => out.some((l) => l.includes("token=")) || err.length > 0, "the address");
    const line = out.join("").trim();
    const url = line ? new URL(line) : undefined;
    return { out, err, stop, done, url };
  }

  const fetchWith = (url: URL, path: string, token: string) =>
    http.get({ host: "127.0.0.1", port: url.port, path, headers: { authorization: `Bearer ${token}` } });

  async function get(url: URL, path: string): Promise<{ status: number; body: string }> {
    const token = url.searchParams.get("token")!;
    return new Promise((resolve, reject) => {
      fetchWith(url, path, token)
        .on("response", (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c: string) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        })
        .on("error", reject);
    });
  }

  it("prints the launch address, serves the API, and stops cleanly on the stop signal", async () => {
    seedRun();
    const ui = await startUi(["--port", "0", "--data-dir", dir]);

    expect(ui.url!.hostname).toBe("127.0.0.1");
    expect(ui.url!.pathname).toBe("/");
    expect(ui.url!.searchParams.get("token")).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(ui.url!.port)).toBeGreaterThan(0);
    const res = await get(ui.url!, "/api/runs");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).runs[0].run.id).toBe("run-1");

    ui.stop.abort();
    expect(await ui.done).toBe(0);
    // The token appears only in the single line with the address.
    const token = ui.url!.searchParams.get("token")!;
    expect(ui.out.join("").split("\n").filter((l) => l.includes(token))).toHaveLength(1);
    expect(ui.err.join("")).not.toContain(token);
    await expect(get(ui.url!, "/api/runs")).rejects.toThrow();
  });

  it("starts without a database and picks it up when it appears", async () => {
    const empty = mkdtempSync(join(tmpdir(), "knit-ui-empty-"));
    try {
      const ui = await startUi(["--port", "0", "--data-dir", empty]);
      expect((await get(ui.url!, "/api/runs")).body).toBe(JSON.stringify({ runs: [] }));
      expect((await get(ui.url!, "/api/runs/run-1")).status).toBe(404);

      const created = new SqliteRunStore(join(empty, "knit.db"));
      created.createRun(RUN);
      const after = await get(ui.url!, "/api/runs");
      created.close();

      expect(JSON.parse(after.body).runs.map((r: any) => r.run.id)).toEqual(["run-1"]);
      ui.stop.abort();
      expect(await ui.done).toBe(0);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("fails clearly when the port is busy", async () => {
    const first = await startUi(["--port", "0", "--data-dir", dir]);
    const busy = capture();

    const code = await main(["ui", "--port", first.url!.port, "--data-dir", dir], busy.io, { stopSignal: new AbortController().signal });

    expect(code).toBe(1);
    expect(busy.err.join("")).toContain(`Port ${first.url!.port} is already in use`);
    expect(busy.out).toEqual([]);
    first.stop.abort();
    await first.done;
  });

  it("rejects a malformed port with a usage error", async () => {
    for (const port of ["abc", "-1", "70000", "1.5", ""]) {
      const { io, err } = capture();
      const code = await main(["ui", "--port", port], io, { stopSignal: AbortSignal.abort() });
      expect(code, port).toBe(2);
      expect(err.join(""), port).toContain("--port");
    }
    const { io, err } = capture();
    expect(await main(["ui", "extra"], io, { stopSignal: AbortSignal.abort() })).toBe(2);
    expect(err.join("")).toContain("Unexpected argument");
  });

  it("is described in the help text", async () => {
    const { io, err } = capture();
    await main(["help"], io);
    expect(err.join("")).toContain("knit ui [options]");
    expect(err.join("")).toContain("Options for ui:");
    expect(err.join("")).toContain("--port <n>");
  });

  it("leaves the existing commands as they were", async () => {
    const empty = mkdtempSync(join(tmpdir(), "knit-ui-cli-"));
    try {
      const runs = capture();
      expect(await main(["runs", "--data-dir", empty], runs.io)).toBe(0);
      expect(runs.out.join("")).toBe("No runs yet\n");
      expect(runs.err).toEqual([]);

      const show = capture();
      expect(await main(["show", "nope", "--data-dir", empty], show.io)).toBe(1);
      expect(show.err.join("")).toContain("Run not found: nope");

      const unknown = capture();
      expect(await main(["serve"], unknown.io)).toBe(2);
      expect(unknown.err.join("")).toContain("Unknown command: serve");

      const none = capture();
      expect(await main([], none.io)).toBe(2);
      expect(none.err.join("")).toContain("Usage:");
      const help = capture();
      expect(await main(["--help"], help.io)).toBe(0);
      expect(help.err.join("")).toContain("knit run <plan.md>");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

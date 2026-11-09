import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteSessionReader } from "../../src/adapters/storage/sqlite/session-reader.js";
import { SqliteSessionStore } from "../../src/adapters/storage/sqlite/session-store.js";
import { FsPlanDrafts } from "../../src/adapters/system/plan-drafts.js";
import type { RunListItem, RunReader } from "../../src/core/ports/run-reader.js";
import { startServer, type RunningServer, type SpawnRequest } from "../../src/server/index.js";

const PLAN = `# Plan: Add login

## T1: Form

Branch: feat/form
Goal: Build the form.
Specs:
- S1: It renders.
Allowed files:
- src/form.ts
Checks:
- pnpm test
`;

let scratch: string;
let repo: string;
let server: RunningServer | undefined;
let spawned: SpawnRequest[];
let runs: RunListItem[];

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "knit-plans-ui-")));
  repo = join(scratch, "target");
  mkdirSync(join(repo, "docs", "plans"), { recursive: true });
  spawned = [];
  runs = [];
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  rmSync(scratch, { recursive: true, force: true });
});

async function launch(): Promise<void> {
  const store = new SqliteSessionStore(join(scratch, "knit.db"));
  store.createSession({ id: "s1", agent: "claude", title: "Plan login", cwd: repo, createdAt: "2026-01-01T00:00:00.000Z" });
  store.close();
  const reader: RunReader = {
    listRuns: () => runs,
    searchRuns: () => ({ items: runs, total: runs.length }),
    getRunSnapshot: () => undefined,
    getRun: () => undefined,
    getLatestAgentEvents: () => [],
    getEventsAfter: () => [],
    getAgentEventsAfter: () => [],
    close: () => {},
  };
  server = await startServer({
    reader,
    port: 0,
    staticDir: join(scratch, "no-web"),
    plans: new FsPlanDrafts(),
    control: {
      dataDir: scratch,
      sessions: { reader: new SqliteSessionReader(join(scratch, "knit.db")), agents: [] },
      spawn: (request) => {
        spawned.push(request);
        return { pid: undefined, exited: Promise.resolve(null) };
      },
    },
  });
}

function get(path: string): Promise<{ status: number; json: () => any }> {
  const s = server!;
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: s.port, path, headers: { host: `127.0.0.1:${s.port}`, authorization: `Bearer ${s.token}` } }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: () => JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
      })
      .on("error", reject);
  });
}

describe("GET /api/sessions/:id/plans", () => {
  it("lists the drafts of the session directory with their validation result", async () => {
    writeFileSync(join(repo, "docs", "plans", "login.md"), PLAN);
    writeFileSync(join(repo, "docs", "plans", "bad.md"), "# Plan: Broken\n");
    await launch();
    const reply = await get("/api/sessions/s1/plans");
    expect(reply.status).toBe(200);
    const body = reply.json();
    expect(body.dir).toBe("docs/plans");
    const byFile = Object.fromEntries(body.plans.map((p: any) => [p.file, p]));
    expect(byFile["login.md"]).toMatchObject({ valid: true, name: "Add login", issues: [], runs: [] });
    expect(byFile["bad.md"].valid).toBe(false);
    expect(byFile["bad.md"].issues.length).toBeGreaterThan(0);
  });

  it("links the runs started from a plan file and starts nothing itself", async () => {
    const path = join(repo, "docs", "plans", "login.md");
    writeFileSync(path, PLAN);
    runs = [{ run: { id: "r1", planPath: path, status: "passed", startedAt: "2026-01-02T00:00:00.000Z" } as any, taskCounts: {} as any, inputTokens: 0, outputTokens: 0 }];
    await launch();
    const body = (await get("/api/sessions/s1/plans")).json();
    expect(body.plans[0].runs).toEqual([{ id: "r1", status: "passed", startedAt: "2026-01-02T00:00:00.000Z" }]);
    expect(spawned).toEqual([]);
  });

  it("answers 404 for an unknown session and an empty list without the directory", async () => {
    rmSync(join(repo, "docs"), { recursive: true });
    await launch();
    expect((await get("/api/sessions/nope/plans")).status).toBe(404);
    expect((await get("/api/sessions/s1/plans")).json().plans).toEqual([]);
  });
});

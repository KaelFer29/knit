import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FsFileTree } from "../../src/adapters/system/file-tree.js";
import { SqliteRunReader } from "../../src/adapters/storage/sqlite/run-reader.js";
import { SqliteRunStore } from "../../src/adapters/storage/sqlite/run-store.js";
import { startServer, type RunningServer } from "../../src/server/index.js";

let dir: string;
let store: SqliteRunStore;
let reader: SqliteRunReader;
let server: RunningServer;

function get(path: string, auth = true): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: server.port,
        path,
        headers: { host: `127.0.0.1:${server.port}`, ...(auth ? { authorization: `Bearer ${server.token}` } : {}) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, json: body ? JSON.parse(body) : undefined });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function launch(withTree: boolean): Promise<void> {
  server = await startServer({
    reader,
    port: 0,
    staticDir: join(dir, "no-web"),
    ...(withTree ? { files: new FsFileTree(100) } : {}),
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "knit-files-"));
  const repo = join(dir, "repo");
  const wt = join(dir, "wt");
  mkdirSync(join(repo, "src"), { recursive: true });
  mkdirSync(wt);
  mkdirSync(join(dir, "secret"));
  writeFileSync(join(repo, "src", "a.ts"), "export {};\n");
  writeFileSync(join(repo, "bin"), Buffer.from([0, 1]));
  writeFileSync(join(repo, "big"), "x".repeat(101));
  writeFileSync(join(wt, "w.txt"), "worktree\n");
  writeFileSync(join(dir, "secret", "s"), "nope");
  symlinkSync(join(dir, "secret"), join(repo, "out"));
  store = new SqliteRunStore(join(dir, "knit.db"));
  store.createRun({ id: "r1", planName: "p", planPath: "/p.md", repo, base: "main@abc", startedAt: "2026-11-08T10:00:00.000Z" });
  store.upsertTask({ runId: "r1", taskId: "T1", title: "First", status: "running", position: 1, worktree: wt });
  store.upsertTask({ runId: "r1", taskId: "T2", title: "Second", status: "pending", position: 2 });
  reader = new SqliteRunReader(join(dir, "knit.db"));
});

afterEach(async () => {
  await server?.close();
  reader.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("file explorer routes", () => {
  it("lists the roots: the repository and each task worktree", async () => {
    await launch(true);
    const r = await get("/api/runs/r1/roots");
    expect(r.status).toBe(200);
    expect(r.json.roots).toEqual([
      { id: "repo", label: "Repository" },
      { id: "T1", label: "T1 First" },
    ]);
  });

  it("lists a directory and reads a file of the repository and of a worktree", async () => {
    await launch(true);
    const list = await get("/api/runs/r1/files?root=repo&path=src");
    expect(list.status).toBe(200);
    expect(list.json).toEqual({ root: "repo", path: "src", entries: [{ name: "a.ts", path: "src/a.ts", kind: "file", size: 11 }] });
    const file = await get("/api/runs/r1/file?root=repo&path=src/a.ts");
    expect(file.json).toEqual({ root: "repo", kind: "text", path: "src/a.ts", size: 11, text: "export {};\n" });
    const wt = await get("/api/runs/r1/file?root=T1&path=w.txt");
    expect(wt.json.text).toBe("worktree\n");
  });

  it("marks binary and oversized files instead of returning bytes", async () => {
    await launch(true);
    expect((await get("/api/runs/r1/file?root=repo&path=bin")).json).toMatchObject({ kind: "binary", size: 2 });
    expect((await get("/api/runs/r1/file?root=repo&path=big")).json).toMatchObject({ kind: "too-large", size: 101, limit: 100 });
  });

  it("refuses traversal, encoded traversal, symlink escapes and .git with 403", async () => {
    await launch(true);
    for (const p of ["..%2Fsecret%2Fs", "src%2F..%2F..%2Fsecret%2Fs", "%2Fetc%2Fpasswd", "out%2Fs", "out", ".git"]) {
      expect((await get(`/api/runs/r1/file?root=repo&path=${p}`)).status, p).toBe(403);
    }
    expect((await get("/api/runs/r1/files?root=repo&path=out")).status).toBe(403);
  });

  it("never takes a directory from the request: unknown or absolute roots are 404", async () => {
    await launch(true);
    expect((await get(`/api/runs/r1/files?root=${encodeURIComponent(dir)}`)).status).toBe(404);
    expect((await get("/api/runs/r1/files?root=T2")).status).toBe(404);
    expect((await get("/api/runs/nope/files?root=repo")).status).toBe(404);
  });

  it("validates parameters and kinds", async () => {
    await launch(true);
    expect((await get("/api/runs/r1/files")).status).toBe(400);
    expect((await get("/api/runs/r1/file?root=repo")).status).toBe(400);
    expect((await get("/api/runs/r1/file?root=repo&path=src")).status).toBe(400);
    expect((await get("/api/runs/r1/files?root=repo&path=missing")).status).toBe(404);
  });

  it("requires the launch token and answers 503 without an explorer", async () => {
    await launch(false);
    expect((await get("/api/runs/r1/files?root=repo")).status).toBe(503);
    expect((await get("/api/runs/r1/files?root=repo", false)).status).toBe(401);
  });
});

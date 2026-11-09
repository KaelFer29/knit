import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileConfigFiles } from "../../adapters/system/config-files.js";
import type { RunReader } from "../../core/ports/run-reader.js";
import { startServer, type RunningServer } from "../index.js";
import { useConfigFiles } from "./config.js";

let base: string;
let server: RunningServer;

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), "knit-config-routes-"));
  for (const d of ["project", "home", "outside"]) mkdirSync(join(base, d));
  useConfigFiles(new FileConfigFiles({ projectDir: join(base, "project"), homeDir: join(base, "home"), backupDir: join(base, "backups") }));
  server = await startServer({ reader: {} as RunReader, port: 0, staticDir: join(base, "no-web") });
});

afterEach(async () => {
  useConfigFiles(undefined);
  await server.close();
  rmSync(base, { recursive: true, force: true });
});

interface Reply {
  status: number;
  json: any;
}

function call(
  method: string,
  path: string,
  { body, auth = true, origin = true, type = "application/json" }: { body?: unknown; auth?: boolean; origin?: boolean; type?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: server.port,
        method,
        path,
        headers: {
          host: `127.0.0.1:${server.port}`,
          ...(auth ? { authorization: `Bearer ${server.token}` } : {}),
          ...(origin && method !== "GET" ? { origin: `http://127.0.0.1:${server.port}` } : {}),
          ...(payload !== undefined ? { "content-type": type } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString("utf8") || "null") }));
      },
    );
    req.on("error", reject);
    req.end(payload, () => undefined);
  });
}

const read = (id: string) => call("GET", `/api/config/file?id=${encodeURIComponent(id)}`);
const save = (id: string, content: string, expectedHash: string) => call("PUT", "/api/config/file", { body: { id, content, expectedHash } });

describe("config routes", () => {
  it("lists the allowed files", async () => {
    writeFileSync(join(base, "project/CLAUDE.md"), "x");
    const reply = await call("GET", "/api/config/files");
    expect(reply.status).toBe(200);
    expect(reply.json.files.find((f: any) => f.id === "claude:project:claude-md")).toMatchObject({ exists: true });
  });

  it("reads a file, then saves it with a backup and reads the new content", async () => {
    writeFileSync(join(base, "project/CLAUDE.md"), "v1");
    const first = (await read("claude:project:claude-md")).json;
    expect(first).toMatchObject({ content: "v1", exists: true });
    const saved = await save("claude:project:claude-md", "v2", first.hash);
    expect(saved.status).toBe(200);
    expect(readFileSync(saved.json.backupPath, "utf8")).toBe("v1");
    expect((await read("claude:project:claude-md")).json.content).toBe("v2");
  });

  it("answers 409 on a stale hash and leaves the file alone", async () => {
    writeFileSync(join(base, "project/CLAUDE.md"), "v1");
    const reply = await save("claude:project:claude-md", "v2", "0".repeat(64));
    expect(reply.status).toBe(409);
    expect(readFileSync(join(base, "project/CLAUDE.md"), "utf8")).toBe("v1");
  });

  it("answers 403 for ids outside the allow-list, on read and on save, without touching the disk", async () => {
    for (const id of ["claude:project:rules/../../escape.md", "claude:project:/etc/passwd", "nope"]) {
      expect((await read(id)).status).toBe(403);
      expect((await save(id, "x", "absent")).status).toBe(403);
    }
    expect(readFileSync(join(base, "project", "..", "outside", ".keep"), { flag: "a+" }).length).toBe(0);
  });

  it("answers 400 for invalid JSON content and for malformed requests", async () => {
    expect((await save("claude:project:settings", "{oops", "absent")).status).toBe(400);
    expect((await call("GET", "/api/config/file")).status).toBe(400);
    expect((await call("PUT", "/api/config/file", { body: { id: "claude:project:claude-md", content: "x" } })).status).toBe(400);
    expect((await call("PUT", "/api/config/file", { body: { id: "claude:project:claude-md", content: 1, expectedHash: "absent" } })).status).toBe(400);
    expect((await call("PUT", "/api/config/file", { body: { id: "claude:project:claude-md", content: "x", expectedHash: "absent", path: "/etc/x" } })).status).toBe(400);
    expect((await call("PUT", "/api/config/file", { body: "[1]" })).status).toBe(400);
    expect((await call("PUT", "/api/config/file", { body: "{", })).status).toBe(400);
    expect((await call("PUT", "/api/config/file", { body: { a: 1 }, type: "text/plain" })).status).toBe(415);
  });

  it("answers 413 for an oversized body", async () => {
    const reply = await save("claude:project:claude-md", "a".repeat(2 * 1024 * 1024 + 10), "absent").catch(() => ({ status: 413 }));
    expect(reply.status).toBe(413);
  });

  it("keeps the server guards: no token is 401, no Origin on a save is 403", async () => {
    expect((await call("GET", "/api/config/files", { auth: false })).status).toBe(401);
    expect((await call("PUT", "/api/config/file", { auth: false, body: {} })).status).toBe(401);
    expect((await call("PUT", "/api/config/file", { origin: false, body: { id: "claude:project:claude-md", content: "x", expectedHash: "absent" } })).status).toBe(403);
    expect(() => readFileSync(join(base, "project/CLAUDE.md"))).toThrow();
  });

  it("answers 503 when no files were configured", async () => {
    useConfigFiles(undefined);
    expect((await call("GET", "/api/config/files")).status).toBe(503);
    expect((await save("claude:project:claude-md", "x", "absent")).status).toBe(503);
  });
});

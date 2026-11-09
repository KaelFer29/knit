import { existsSync } from "node:fs";
import { join } from "node:path";
import { SqliteRunReader } from "../../adapters/storage/sqlite/run-reader.js";
import { lazyRunReader, PortInUseError, startServer } from "../../server/index.js";
import { UsageError } from "../errors.js";
import { parse } from "../support/args.js";
import { DB_FILENAME, dataDirOf } from "../support/paths.js";
import type { CliDeps, CliIo } from "../types.js";

const DEFAULT_PORT = 4317;

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n > 65535) throw new UsageError(`--port must be a whole number from 0 to 65535, got '${raw}'`);
  return n;
}

/** Resolves when SIGINT or SIGTERM arrives (or when `signal` aborts, which tests use instead). */
function waitForStop(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = (): void => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    signal?.addEventListener("abort", done);
    if (!signal) {
      process.once("SIGINT", done);
      process.once("SIGTERM", done);
    }
  });
}

/**
 * Serves the web interface on 127.0.0.1 until interrupted. The database is opened read-only, and only once it exists:
 * a first launch before any run shows an empty list and picks the database up when `knit run` creates it.
 * It prints the launch URL, which carries the per-launch token, and never opens a browser.
 */
export async function uiCommand(args: string[], io: CliIo, deps: CliDeps, env: NodeJS.ProcessEnv): Promise<number> {
  const { values } = parse(args, { port: { type: "string" }, "data-dir": { type: "string" } }, false);
  const port = parsePort(values.port);
  const dbPath = join(dataDirOf({ "data-dir": values["data-dir"] }, env), DB_FILENAME);
  const reader = lazyRunReader(() => (existsSync(dbPath) ? new SqliteRunReader(dbPath) : undefined));

  let server;
  try {
    server = await startServer({ reader, port });
  } catch (err) {
    reader.close();
    if (err instanceof PortInUseError) {
      io.err(`Port ${err.port} is already in use. Stop the other process, pick another with --port <n>, or use --port 0 for a free one.\n`);
      return 1;
    }
    throw err;
  }

  io.out(`${server.url}\n`);
  io.err("Open the address above in your browser. Press Ctrl+C to stop.\n");
  await waitForStop(deps.stopSignal);
  await server.close();
  reader.close();
  return 0;
}

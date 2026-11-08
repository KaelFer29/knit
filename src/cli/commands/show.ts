import { UsageError } from "../errors.js";
import { parse } from "../support/args.js";
import { formatRunDetail } from "../support/format.js";
import { openStoreIfExists } from "../support/paths.js";
import type { CliIo } from "../types.js";

export function showCommand(args: string[], io: CliIo, env: NodeJS.ProcessEnv): number {
  const { values, positionals } = parse(args, { "data-dir": { type: "string" } });
  if (positionals.length !== 1) throw new UsageError("show needs exactly one run id");
  const id = positionals[0]!;
  const store = openStoreIfExists(env, values["data-dir"]);
  const detail = store?.getRun(id);
  store?.close();
  if (!detail) {
    io.err(`Run not found: ${id}\n`);
    return 1;
  }
  io.out(formatRunDetail(detail) + "\n");
  return 0;
}

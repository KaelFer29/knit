import { parse } from "../support/args.js";
import { formatRunLine } from "../support/format.js";
import { openStoreIfExists } from "../support/paths.js";
import type { CliIo } from "../types.js";

export function runsCommand(args: string[], io: CliIo, env: NodeJS.ProcessEnv): number {
  const { values } = parse(args, { "data-dir": { type: "string" } }, false);
  const store = openStoreIfExists(env, values["data-dir"]);
  const list = store?.listRuns() ?? [];
  store?.close();
  if (list.length === 0) {
    io.out("No runs yet\n");
    return 0;
  }
  io.out(list.map(formatRunLine).join("\n") + "\n");
  return 0;
}

import { UsageError } from "../errors.js";
import { parse } from "../support/args.js";
import { formatAgentEvent } from "../support/format.js";
import { openStoreIfExists } from "../support/paths.js";
import type { CliDeps, CliIo } from "../types.js";

/** Prints what the agent did (thinking, messages, tool calls); `--follow` keeps going while the run is active. */
export async function logsCommand(args: string[], io: CliIo, deps: CliDeps, env: NodeJS.ProcessEnv): Promise<number> {
  const { values, positionals } = parse(args, {
    "data-dir": { type: "string" },
    task: { type: "string" },
    follow: { type: "boolean" },
  });
  if (positionals.length !== 1) throw new UsageError("logs needs exactly one run id");
  const id = positionals[0]!;
  const store = openStoreIfExists(env, values["data-dir"]);
  if (!store?.getRun(id)) {
    store?.close();
    io.err(`Run not found: ${id}\n`);
    return 1;
  }
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let afterId = 0;
  let printed = 0;
  try {
    for (;;) {
      const events = store.getAgentEvents(id, {
        afterId,
        ...(values.task ? { taskId: values.task } : {}),
      });
      for (const e of events) io.out(`${formatAgentEvent(e)}\n`);
      printed += events.length;
      if (events.length > 0) afterId = events.at(-1)!.id;
      if (!values.follow) break;
      if (events.length === 0 && store.getRun(id)?.run.status !== "running") break;
      await sleep(500);
    }
  } finally {
    store.close();
  }
  if (printed === 0) io.out("No events for this run (or task) yet\n");
  return 0;
}

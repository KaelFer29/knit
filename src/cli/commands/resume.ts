import { UsageError } from "../errors.js";
import { parse, RUN_OPTIONS } from "../support/args.js";
import { loadPlan, openStoreIfExists } from "../support/paths.js";
import type { CliDeps, CliIo } from "../types.js";
import { execute } from "./execute.js";

export async function resumeCommand(args: string[], io: CliIo, deps: CliDeps, env: NodeJS.ProcessEnv, cwd: string): Promise<number> {
  const { values, positionals } = parse(args, RUN_OPTIONS);
  if (positionals.length !== 1) throw new UsageError("resume needs exactly one run id");
  const runId = positionals[0]!;
  const store = openStoreIfExists(env, values["data-dir"]);
  const detail = store?.getRun(runId);
  store?.close();
  if (!detail) {
    io.err(`Run not found: ${runId}\n`);
    return 1;
  }
  const { plan } = loadPlan(detail.run.planPath, env, cwd);
  return execute({ ...plan, repo: detail.run.repo }, detail.run.planPath, values, io, deps, env, runId);
}

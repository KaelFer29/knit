import { UsageError } from "../errors.js";
import { parse } from "../support/args.js";
import { loadPlan } from "../support/paths.js";
import type { CliIo } from "../types.js";

export function validateCommand(args: string[], io: CliIo, env: NodeJS.ProcessEnv, cwd: string): number {
  const { positionals } = parse(args, {});
  if (positionals.length !== 1) throw new UsageError("validate needs exactly one plan file");
  const { plan } = loadPlan(positionals[0]!, env, cwd);
  io.out(`OK: plan '${plan.name}' with ${plan.tasks.length} task${plan.tasks.length === 1 ? "" : "s"}\n`);
  return 0;
}

import { renderPrompt } from "../../core/prompt/render-prompt.js";
import { UsageError } from "../errors.js";
import { parse, RUN_OPTIONS } from "../support/args.js";
import { loadPlan } from "../support/paths.js";
import type { CliDeps, CliIo } from "../types.js";
import { execute } from "./execute.js";

export async function runCommand(args: string[], io: CliIo, deps: CliDeps, env: NodeJS.ProcessEnv, cwd: string): Promise<number> {
  const { values, positionals } = parse(args, RUN_OPTIONS);
  if (positionals.length !== 1) throw new UsageError("run needs exactly one plan file");
  const { plan, path, text } = loadPlan(positionals[0]!, env, cwd);

  if (values["dry-run"]) {
    io.out(`Dry run: plan '${plan.name}', repo ${plan.repo}\n`);
    if (plan.setup.length > 0) io.out(`Setup in every worktree: ${plan.setup.join(" && ")}\n`);
    for (const task of plan.tasks) {
      io.out(`\n===== ${task.id}: ${task.title} (branch ${task.branch}${task.dependsOn ? `, from ${task.dependsOn}` : ""}${task.model ? `, model ${task.model}` : ""}) =====\n`);
      io.out(renderPrompt(task));
      io.out(`Checks: ${task.checks.length > 0 ? task.checks.join(" ; ") : "(none)"}\n`);
    }
    return 0;
  }
  return execute(plan, path, values, io, deps, env, undefined, text);
}

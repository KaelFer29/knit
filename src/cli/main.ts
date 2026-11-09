import { abortCommand } from "./commands/abort.js";
import { branchCommand } from "./commands/branch.js";
import { chatCommand } from "./commands/chat.js";
import { cleanCommand } from "./commands/clean.js";
import { followupCommand } from "./commands/followup.js";
import { logsCommand } from "./commands/logs.js";
import { resumeCommand } from "./commands/resume.js";
import { runCommand } from "./commands/run.js";
import { runsCommand } from "./commands/runs.js";
import { showCommand } from "./commands/show.js";
import { uiCommand } from "./commands/ui.js";
import { validateCommand } from "./commands/validate.js";
import { UsageError } from "./errors.js";
import type { CliDeps, CliIo } from "./types.js";
import { USAGE } from "./usage.js";

export type { CliDeps, CliIo } from "./types.js";

/**
 * Routes a command line to its command module and turns failures into exit codes:
 * 0 ok, 1 the work failed, 2 usage or plan error.
 */
export async function main(argv: string[], io: CliIo, deps: CliDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const cwd = deps.cwd ?? process.cwd();
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "validate":
        return validateCommand(rest, io, env, cwd);
      case "run":
        return await runCommand(rest, io, deps, env, cwd);
      case "resume":
        return await resumeCommand(rest, io, deps, env, cwd);
      case "runs":
        return runsCommand(rest, io, env);
      case "show":
        return showCommand(rest, io, env);
      case "logs":
        return await logsCommand(rest, io, deps, env);
      case "chat":
        return await chatCommand(rest, io, deps, env, cwd);
      case "followup":
        return await followupCommand(rest, io, deps, env);
      case "clean":
        return cleanCommand(rest, io, deps, env);
      case "branch":
        return await branchCommand(rest, io, deps, env);
      case "abort":
        return await abortCommand(rest, io, deps, env);
      case "ui":
        return await uiCommand(rest, io, deps, env);
      case undefined:
      case "help":
      case "--help":
      case "-h":
        io.err(USAGE);
        return command === undefined ? 2 : 0;
      default:
        io.err(`Unknown command: ${command}\n\n${USAGE}`);
        return 2;
    }
  } catch (err) {
    if (err instanceof UsageError) {
      io.err(`${err.message}\n`);
      return 2;
    }
    io.err(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
}

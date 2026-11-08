import { rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { GitWorkspace } from "../../adapters/vcs/git/git-workspace.js";
import { UsageError } from "../errors.js";
import { parse } from "../support/args.js";
import { dataDirOf, openStoreIfExists } from "../support/paths.js";
import type { CliDeps, CliIo } from "../types.js";

/** Removes a run's worktrees; branches are only deleted when merged and only on request. */
export function cleanCommand(args: string[], io: CliIo, deps: CliDeps, env: NodeJS.ProcessEnv): number {
  const { values, positionals } = parse(args, {
    "data-dir": { type: "string" },
    "delete-branches": { type: "boolean" },
    force: { type: "boolean" },
  });
  if (positionals.length !== 1) throw new UsageError("clean needs exactly one run id");
  const id = positionals[0]!;
  const dataDir = dataDirOf(values, env);
  const store = openStoreIfExists(env, values["data-dir"]);
  const detail = store?.getRun(id);
  store?.close();
  if (!detail) {
    io.err(`Run not found: ${id}\n`);
    return 1;
  }
  if (detail.run.status === "running" && !values.force) {
    io.err(`Run ${id} is still marked as running. If it crashed, repeat with --force.\n`);
    return 1;
  }
  if (!/^[\w.-]+$/.test(id)) throw new UsageError(`Unsafe run id: ${id}`);

  const root = join(dataDir, "worktrees");
  const runDir = join(root, id);
  const workspace = new GitWorkspace({ root, ...(deps.gitArgs ? { gitArgs: deps.gitArgs } : {}) });
  for (const t of detail.tasks) {
    if (!t.worktree) continue;
    if (!resolve(t.worktree).startsWith(runDir + sep)) {
      io.err(`Skipping ${t.worktree}: not inside ${runDir}\n`);
      continue;
    }
    workspace.removeWorktree(detail.run.repo, t.worktree);
    io.out(`removed worktree: ${t.worktree}\n`);
  }
  rmSync(runDir, { recursive: true, force: true });

  if (values["delete-branches"]) {
    for (const t of detail.tasks) {
      if (!t.branch || !workspace.hasBranch(detail.run.repo, t.branch)) continue;
      if (workspace.deleteBranch(detail.run.repo, t.branch)) io.out(`deleted branch: ${t.branch}\n`);
      else io.out(`kept (not merged): ${t.branch}\n`);
    }
  } else if (detail.tasks.some((t) => t.branch)) {
    io.out("Branches were kept. Use --delete-branches to remove the merged ones.\n");
  }
  return 0;
}

/** Name shown in help and hints. Change it here when the tool is renamed. */
export const PROGRAM_NAME = "knit";

export const USAGE = `Usage:
  ${PROGRAM_NAME} run <plan.md> [options]     Run a plan task by task
  ${PROGRAM_NAME} resume <run-id> [options]   Continue a run: passed tasks are kept, the rest are re-run
  ${PROGRAM_NAME} validate <plan.md>          Check a plan file without running anything
  ${PROGRAM_NAME} runs                        List past runs
  ${PROGRAM_NAME} show <run-id>               Show tasks, attempts, tokens, branches and PRs of a run
  ${PROGRAM_NAME} logs <run-id> [options]     Show what the agent did: thinking, messages, tool calls and results
  ${PROGRAM_NAME} clean <run-id> [options]    Remove the worktrees of a run (branches are kept)

Options for run and resume:
  --dry-run                  (run only) Print the prompts that would be sent; change nothing
  --push                     Push each passed task's branch to origin
  --pr                       Push and open a pull request per task (stacked tasks target their parent's branch)
  --max-attempts <n>         Attempts per task before failing it (default 2)
  --agent-timeout-min <n>    Timeout per agent attempt in minutes (default 10)
  --check-timeout-min <n>    Timeout per check or setup command in minutes (default 5)
  --model <name>             Model passed to the agent (--model)
  --agent-command <bin>      Agent binary (default: agent)
  --data-dir <dir>           Database and worktrees location (default: ~/.knit, or $KNIT_HOME)

Options for logs:
  --task <id>                Only one task (e.g. T1)
  --follow                   Keep printing new events while the run is in progress
  --data-dir <dir>

Options for clean:
  --delete-branches          Also delete the task branches that are merged (never unmerged ones)
  --force                    Clean a run that is still marked as running (e.g. after a crash)
  --data-dir <dir>
`;

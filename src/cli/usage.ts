/** Name shown in help and hints. Change it here when the tool is renamed. */
export const PROGRAM_NAME = "knit";

export const USAGE = `Usage:
  ${PROGRAM_NAME} run <plan.md> [options]     Run a plan task by task
  ${PROGRAM_NAME} resume <run-id> [options]   Continue a run: passed tasks are kept, the rest are re-run
  ${PROGRAM_NAME} validate <plan.md>          Check a plan file without running anything
  ${PROGRAM_NAME} runs                        List past runs
  ${PROGRAM_NAME} show <run-id>               Show tasks, attempts, tokens, branches and PRs of a run
  ${PROGRAM_NAME} abort <run-id> [options]    Stop a running run (SIGINT, then SIGKILL after a grace period); a run whose process is gone is marked failed
  ${PROGRAM_NAME} logs <run-id> [options]     Show what the agent did: thinking, messages, tool calls and results
  ${PROGRAM_NAME} chat <prompt> [options]     Run one turn of an agent (Claude by default) and record it as a resumable session
  ${PROGRAM_NAME} followup <run-id> <task-id> <prompt> [options]
                                      Send a follow-up to the Cursor chat of a task and verify the result again
  ${PROGRAM_NAME} clean <run-id> [options]    Remove the worktrees of a run (branches are kept)
  ${PROGRAM_NAME} branch <run-id> <task-id> undo --mode <revert|reset|delete> [options]
                                              Take back what a task did on its branch (says what it would do until --yes)
  ${PROGRAM_NAME} branch <run-id> <task-id> pr-draft [--template] [options]
                                              Write the title and body of a pull request for the task (--template: from the task itself, no model)
  ${PROGRAM_NAME} branch <run-id> <task-id> pr --title <t> --body <b> [--base <branch>] [options]
                                              Push the task branch and open its pull request
  ${PROGRAM_NAME} ui [options]                Serve the web interface on 127.0.0.1 and print its address (Ctrl+C to stop)

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

Options for abort:
  --grace-seconds <n>        Wait this long after SIGINT before killing the process group (default 10)
  --data-dir <dir>

Options for logs:
  --task <id>                Only one task (e.g. T1)
  --follow                   Keep printing new events while the run is in progress
  --data-dir <dir>

Options for ui:
  --port <n>                 Port to listen on (default 4317; 0 picks a free one). It always binds to 127.0.0.1
  --data-dir <dir>

Options for chat:
  --agent <claude|cursor>    Agent to talk to (default: claude); a session keeps its agent
  --session <id>             Continue an earlier session instead of starting a new one (the agent resumes its conversation)
  --cwd <dir>                Directory the agent works in, usually the repository to plan in (default: the current one; new sessions only)
  --model <name>             Model for this turn
  --effort <level>           (claude) Reasoning effort for this turn
  --permission-mode <mode>   (claude) Permission mode for this turn, for example plan
  --agent-command <bin>      Agent binary (default: claude, or agent for cursor)
  --data-dir <dir>
  Claude runs with your normal configuration (CLAUDE.md, rules, skills, MCP servers). The turn streams as it happens,
  then prints the answer and the session id; exit code 0 when the turn passed, 1 when it failed.

Options for followup:
  --model <name>             Model for this turn (see 'agent models')
  --agent-command <bin>      Agent binary (default: agent)
  --data-dir <dir>
  The agent resumes the task's chat (agent --resume) inside the task's own worktree, with your prompt as typed. Knit then
  verifies the result like an attempt of the run: scope, git hygiene and the task's checks, against the plan snapshot stored
  with the run. The outcome is recorded as the task's next attempt and the turn as part of a session. Refused (exit 1) while
  the run is still running, when the worktree is gone, when no attempt recorded a chat id, or for a run from before plan
  snapshots. Exit code 0 when the verification passed, 1 otherwise, 2 for usage mistakes.

Options for branch undo:
  --mode revert              Add one commit that restores the code to how it was before the task (history is kept)
  --mode reset               Move the branch back to the commit the task started from (its commits leave the branch)
  --mode delete              Remove the task worktree and delete the branch, merged or not
  --yes                      Do it; without it the command only prints what it would do and changes nothing
  --json                     Print one JSON line (used by the web interface)
  --data-dir <dir>
  pr-draft: --template builds the text from the task's goal and specs, with no model and no tokens (the commits and files are on the pull request)
  (the same sections every time; it cannot be combined with --model). Without it, --model <id> picks the model (default composer-2.5-fast, see 'agent models'). It writes text only, in an empty
  scratch directory, from the task, its commits and a cut of its diff.
  pr: pushes the branch to origin (never forced) and opens the pull request into the run's base branch, or into the parent
  task's branch when the task depends on another (that branch must be on origin first). --base <branch> opens it into
  another branch instead (a plain branch name; GitHub refuses one that is not on origin). Only for a task that passed, with
  commits and no pull request yet; the address is kept with the task. Checks the GitHub CLI and that the base branch is on origin before pushing anything.
  A title or body that starts with a dash has to be written --title="-fix typo" and --body="- adds it", or it reads as an option.
  undo: refused (exit 1) while the run is still running, for a branch that is gone, with uncommitted changes (revert), after
  a rewritten history (reset), or when another task is stacked on the branch (reset, delete). A remote is never touched.

Options for clean:
  --delete-branches          Also delete the task branches that are merged (never unmerged ones)
  --force                    Clean a run that is still marked as running (e.g. after a crash)
  --data-dir <dir>
`;

/** Name shown in help and hints. Change it here when the tool is renamed. */
export const PROGRAM_NAME = "knit";

export const USAGE = `Usage:
  ${PROGRAM_NAME} run <plan.md> [options]     Run a plan task by task
  ${PROGRAM_NAME} resume <run-id> [options]   Continue a run: passed tasks are kept, the rest are re-run
  ${PROGRAM_NAME} validate <plan.md>          Check a plan file without running anything
  ${PROGRAM_NAME} runs                        List past runs
  ${PROGRAM_NAME} show <run-id>               Show tasks, attempts, tokens, branches and PRs of a run
  ${PROGRAM_NAME} logs <run-id> [options]     Show what the agent did: thinking, messages, tool calls and results
  ${PROGRAM_NAME} chat <prompt> [options]     Run one turn of an agent (Claude by default) and record it as a resumable session
  ${PROGRAM_NAME} clean <run-id> [options]    Remove the worktrees of a run (branches are kept)
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

Options for clean:
  --delete-branches          Also delete the task branches that are merged (never unmerged ones)
  --force                    Clean a run that is still marked as running (e.g. after a crash)
  --data-dir <dir>
`;

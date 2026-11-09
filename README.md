# Knit

Knit turns a plan into verified, stacked pull requests, with coding agents as the hands. It runs a plan task by task: one git worktree per task, the Cursor CLI (`agent -p`) as implementer, shell checks as verification, and SQLite as run history. Knit is deterministic code, not an agent: the intelligence lives in the agents behind the ports.

Status: MVP. Full documentation in [docs/](docs/README.md); sample plans in [examples/](examples/README.md).

## Requirements

- Node 20+, pnpm, git
- Cursor CLI installed and logged in (`agent status` must say "Logged in")

## Usage

```bash
pnpm install
pnpm build

node dist/cli/index.js validate plan.md          # parse only
node dist/cli/index.js run plan.md --dry-run     # print the prompts, change nothing
node dist/cli/index.js run plan.md               # run for real (local branches only)
node dist/cli/index.js run plan.md --pr          # also push and open one PR per task
node dist/cli/index.js resume <run-id>           # continue a run that stopped
node dist/cli/index.js abort <run-id>            # stop a running run (SIGINT, then SIGKILL after 10 s)
node dist/cli/index.js runs                      # list runs
node dist/cli/index.js show <run-id>             # tasks, attempts, tokens, branches, PRs
node dist/cli/index.js logs <run-id> --follow    # watch what the agent is doing, live
node dist/cli/index.js clean <run-id>            # remove the run's worktrees
node dist/cli/index.js ui [--port 4317]          # serve the web interface on 127.0.0.1 (see "Web interface" below)
node dist/cli/index.js chat "Plan the board" --cwd ~/code/app    # one turn with Claude, recorded as a session
node dist/cli/index.js chat "Split it in tasks" --session <id>   # next turn: Claude resumes the same conversation
node dist/cli/index.js followup <run-id> T1 "Also cover the empty case"   # more work on a task's Cursor chat, verified again
```

Optionally run `pnpm link --global` to get a `knit` command instead of `node dist/cli/index.js`.

Run it from inside the project you want to change: if the plan has no `Repo:`, the repository of the current directory is used. Options: `--push`, `--pr`, `--max-attempts`, `--agent-timeout-min`, `--check-timeout-min`, `--model`, `--agent-command`, `--data-dir`. Data (SQLite database and worktrees) lives in `~/.knit` unless `--data-dir` or `$KNIT_HOME` says otherwise.

Exit codes: `0` run passed, `1` a task failed, `2` usage or plan error.

`run` and `resume` are one-shot commands, not servers: they start, run the plan, write the history to SQLite and exit. Nothing listens in the background. The only long-lived command is `ui`, which you start yourself: it serves the web interface on `127.0.0.1` (see [docs/web-interface.md](docs/web-interface.md#knit-ui)).

### Web interface

`knit ui` serves the web app on `127.0.0.1` and prints its address with a launch token; it never opens a browser. It only reads the database, and starts Knit commands (runs, chat turns) as child processes. It is one interactive view:

- **Three blocks and a pipeline:** Claude (planner), Knit (orchestrator) and Cursor (builder), each showing its live state and latest actions, joined by animated wires that show the stage of each hop and short log lines of what travels on them.
- **Modals:** clicking a block opens its panel as a modal over the pipeline. Claude: sessions, model, chat with command palette and usage, a "Send to the orchestrator" switch that makes the agent draft a Knit plan, the detected plan and an explicit "Send plan to the orchestrator". Orchestrator: run summary, task queue with checks and verdicts, run control (start, abort, resume, retry) and the runs picker. Cursor: the active task's live timeline, attempts, diffs, files touched and a file explorer.
- **Configuration:** the Claude and Cursor configuration files (project and global), opened from the header as a preview, edited with undo history and a diff before saving, with a backup of the previous version.

Requirements for the web app: Node 20.19 or newer to build it (Vite 7). Details and known limits in [docs/web-interface.md](docs/web-interface.md).

### Chat sessions

`knit chat <prompt>` runs ONE turn of an agent and records it, outside any plan. Options: `--agent claude|cursor` (default `claude`), `--session <id>`, `--cwd <dir>`, `--model`, `--effort`, `--permission-mode` (Claude only), `--agent-command`, `--data-dir`. Without `--session` it starts a new session titled after the prompt, working in `--cwd` (default: the current directory, which is the repository Claude plans in). The turn streams as it happens in the same format as `logs`, then prints the answer and the session id; the exit code is `0` when the turn passed and `1` when it failed. With `--session <id>` the agent resumes its own conversation, so a plan can be built over several turns.

Claude runs through `claude -p` with your normal Claude configuration (CLAUDE.md, rules, skills, MCP servers) and your subscription; no API key is involved. Sessions, turns and their timelines go to the same SQLite database as runs (see [docs/data-model.md](docs/data-model.md#chat-sessions)). Cursor sessions resume too (`agent --resume <chatId>`), and `--model` sets the model of a turn for either agent.

It is a one-shot command, not a server: it starts, runs the turn, writes the history to SQLite and exits. Nothing listens in the background.

### Follow-ups on a task

`knit followup <run-id> <task-id> "<prompt>"` sends one more prompt to the Cursor chat of a task (`agent --resume`), inside the task's own worktree, and has Knit verify the result again: scope, git hygiene and the task's checks, against the plan stored with the run. Options: `--model`, `--agent-command`, `--data-dir`. The outcome is recorded as the task's next attempt, so `show` and `logs` list it, and the turn is kept as a session (see `chat`). Exit code `0` when the verification passed, `1` when it failed or the follow-up was refused (the run is still running, the worktree is gone, no chat id was recorded, or the run predates plan snapshots), `2` for usage mistakes. After a passing follow-up on a failed run, `resume` keeps the task as passed and continues. Details in [docs/run-lifecycle.md](docs/run-lifecycle.md#follow-ups).

## What a run does

For each task, in file order:

1. Create a worktree on the task's branch (`Branch:` in the plan). A task without `Depends:` starts from the plan base; a task with `Depends: T1` starts from T1's branch, so branches stack.
2. Run the plan's `Setup` commands in the worktree.
3. Run `agent -p --force --output-format stream-json` in the worktree. The agent edits files **and commits them itself** (one commit per sub-functionality, `type(scope): description`, single line).
4. Verify: the process ended cleanly, only allowed files changed, nothing was written next to the worktree, the branch and history are intact, every commit follows the format, nothing is left uncommitted, something changed, and every check exits 0.
5. On failure, retry with the feedback (max 2 attempts by default). On success, optionally push and open a PR (`--pr`): independent tasks target the base branch, dependent tasks target their parent's branch.

A failed task stops the run and the remaining tasks are skipped; fix the cause and `resume`. Nothing is merged: review and merge the PRs yourself. Details in [docs/run-lifecycle.md](docs/run-lifecycle.md).

## Layout

```
src/core/        pure logic (plan, prompt, verification, timeline, run loop, chat turn) and the ports
src/adapters/    implementations of the ports: agents, vcs, checks, storage, system
src/server/      local HTTP server of the web interface (routes, live stream, security guard)
src/cli/         command line: one module per command
test/integration/ tests that cross layers; unit tests sit next to their module
docs/            architecture, plan format, run lifecycle, data model
examples/        sample plans
```

See [docs/architecture.md](docs/architecture.md) for the dependency rule and how to extend it.

## Development

```bash
pnpm test         # vitest
pnpm typecheck
pnpm build
```

Tests never touch your global git config or hooks: scratch repos disable hooks explicitly. Commits in this repo must follow `type(scope): description` (the global hook enforces it).

## Recommended agent setup

The implementer's prompt is self-contained (specs, allowed files, git rules), so it does not need persistent memory. MCP servers configured for the Cursor CLI are loaded in every run: they cost tokens and can write into your memory store from throwaway worktrees. Disable them for the CLI with `agent mcp disable <server>` (check with `agent mcp list`). This is a setting of the Cursor CLI, not of Knit.

## Known limits

- The agent runs with `--force`. `agent --sandbox enabled` was tried and did not stop writes outside the working directory, so it is not used. Knit detects writes inside the worktree and next to it, not elsewhere on disk, and not in files ignored by `.gitignore`.
- Push and PR failures are warnings, not task failures; `resume --pr` retries them.
- Sequential only: no parallel tasks; a task depends on at most one earlier task.
- Only Cursor implements tasks. Claude plans through `knit chat`, but it does not verify attempts: checks are the only verification.
- The web interface has known limits (for example, no durable run-to-session link and check output not stored), listed in [docs/web-interface.md](docs/web-interface.md#known-limits-and-follow-ups).

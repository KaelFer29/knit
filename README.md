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
node dist/cli/index.js runs                      # list runs
node dist/cli/index.js show <run-id>             # tasks, attempts, tokens, branches, PRs
node dist/cli/index.js logs <run-id> --follow    # watch what the agent is doing, live
node dist/cli/index.js clean <run-id>            # remove the run's worktrees
node dist/cli/index.js ui [--port 4317]          # serve the web interface on 127.0.0.1 (read-only view of the runs)
```

Optionally run `pnpm link --global` to get a `knit` command instead of `node dist/cli/index.js`.

Run it from inside the project you want to change: if the plan has no `Repo:`, the repository of the current directory is used. Options: `--push`, `--pr`, `--max-attempts`, `--agent-timeout-min`, `--check-timeout-min`, `--model`, `--agent-command`, `--data-dir`. Data (SQLite database and worktrees) lives in `~/.knit` unless `--data-dir` or `$KNIT_HOME` says otherwise.

Exit codes: `0` run passed, `1` a task failed, `2` usage or plan error.

`run` and `resume` are one-shot commands, not servers: they start, run the plan, write the history to SQLite and exit. Nothing listens in the background. The only long-lived command is `ui`, which you start yourself: it serves the web interface on `127.0.0.1` (see [docs/web-interface.md](docs/web-interface.md#knit-ui)).

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
src/core/        pure logic (plan, prompt, verification, timeline, run loop) and the ports
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
- No planner or verifier agents yet; checks are the only verification.
- No web board yet. Every run already stores the full agent timeline in SQLite (`agent_events`) and raw transcripts on disk for it; `logs --follow` is the terminal version.

# Architecture

Hexagonal: Knit's logic does not know which agent, git host or database it talks to. It only knows ports.

```
src/
  core/            pure logic, no I/O
    ports/           interfaces the core needs (AgentRunner, Workspace, RunStore, ...)
    plan/            parse and validate a plan file
    prompt/          render the implementer prompt (and retry feedback)
    verification/    acceptance rules: scope of changed files, git hygiene
    timeline/        normalize each agent's raw stream (Cursor, Claude) into one readable timeline
    run/             the run loop and pull request text
  adapters/        implementations of the ports
    agents/cursor/   AgentRunner for the Cursor CLI
    vcs/git/         Workspace (worktrees, branches, inspection, push)
    vcs/github/      PullRequests through the gh CLI
    checks/shell/    CheckRunner (bash)
    storage/sqlite/  RunStore
    storage/files/   TranscriptStore (raw JSONL)
    system/          process spawning with timeouts and group kill
  cli/             command line: wires adapters into the core
    commands/        one module per command
    support/         argument parsing, paths, formatting
test/integration/  tests that cross layers (CLI against real git and SQLite)
```

## Dependency rule

`core` imports nothing outside `core`. `adapters` import `core/ports` (and a few core types). `cli` imports both and is the only place where adapters are chosen. This is what keeps the core testable with fakes and the adapters replaceable.

## Ports

| Port | Role | Adapter |
| --- | --- | --- |
| `AgentRunner` | run one agent attempt or turn in a directory, streaming events; may name itself (`name`), which labels its timeline entries; may declare `capabilities`; a request may resume a session (`resumeSessionId`) and carry a per-turn `profile`; a result may carry `meta` (command list, plan usage, model) | `agents/cursor` |
| `CheckRunner` | run a shell check or setup command | `checks/shell` |
| `Workspace` | worktree and branch per task, inspection, push | `vcs/git` |
| `PullRequests` | open pull requests | `vcs/github` |
| `RunStore` | persist runs (with a snapshot of the plan and the pid executing them), tasks, attempts, events | `storage/sqlite` |
| `TranscriptStore` | keep the raw agent stream | `storage/files` |

### Agent capabilities

`AgentRunner.capabilities` (`resume`, `chooseModel`, `commandList`, `visibleReasoning`, `planUsage`, all booleans) states what an adapter supports, so a caller asks the runner and never branches on its name. It is optional: `capabilitiesOf(runner)` returns all-false for a runner that declares none, which keeps simple runners and test fakes unchanged. A runner ignores request fields its capabilities do not cover.

## Extending

- **Another agent** (for example Claude Code headless): implement `AgentRunner` under `adapters/agents/<name>/`, then choose it in `cli/commands/execute.ts`.
- **Another code host**: implement `PullRequests` under `adapters/vcs/<host>/`.
- **Another command**: add `cli/commands/<name>.ts`, route it in `cli/main.ts` and describe it in `cli/usage.ts`.
- **A new acceptance rule**: add a pure function under `core/verification/` and call it from `core/run/run-plan.ts`.

## Tests

Unit tests sit next to the module (`foo.ts`, `foo.test.ts`); fake binaries used by adapter tests live in a sibling `__fixtures__/` folder. `test/integration/` holds tests that need several real layers at once. Tests never touch the user's global git config or hooks: scratch repos disable hooks explicitly.

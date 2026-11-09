# Architecture

Hexagonal: Knit's logic does not know which agent, git host or database it talks to. It only knows ports.

```
src/
  core/            pure logic, no I/O
    ports/           interfaces the core needs (AgentRunner, Workspace, RunStore, RunReader, ...)
    plan/            parse and validate a plan file
    prompt/          render the implementer prompt (and retry feedback)
    verification/    acceptance rules: scope of changed files, git hygiene
    timeline/        normalize each agent's raw stream (Cursor, Claude) into one readable timeline
    board/           pure view model of a run for the web interface (task states, queue, wires, totals)
    run/             the run loop and pull request text
  adapters/        implementations of the ports
    agents/cursor/   AgentRunner for the Cursor CLI
    agents/claude/   AgentRunner for Claude Code headless (`claude -p`, stream-json, resumable sessions); not chosen by any command yet
    vcs/git/         Workspace (worktrees, branches, inspection, push)
    vcs/github/      PullRequests through the gh CLI
    checks/shell/    CheckRunner (bash)
    storage/sqlite/  RunStore (read-write) and RunReader (read-only)
    storage/files/   TranscriptStore (raw JSONL)
    system/          process spawning with timeouts and group kill
  server/          driving adapter: HTTP API, live stream (SSE), static files and the security guard of `knit ui`; receives a `RunReader`, knows nothing about SQLite
  cli/             command line: wires adapters into the core
    commands/        one module per command
    support/         argument parsing, paths, formatting
web/               browser app (Vite + React + TypeScript), built to dist/web; talks only to the HTTP API
  src/identity/      agent identities: label, role, brand tokens, logo file
  src/fixtures/      typed BoardModel samples the canvas is drawn from until it has live data
  src/atoms, molecules, organisms/   presentational components; containers (App) own state
  src/styles/        design tokens (light and dark) and base styles
test/integration/  tests that cross layers (CLI against real git and SQLite)
```

## Dependency rule

`core` imports nothing outside `core`. `adapters` import `core/ports` (and a few core types). `server` imports `core` (ports and the board view model) and no adapter. `cli` imports all of them and is the only place where adapters are chosen. This is what keeps the core testable with fakes and the adapters replaceable.

## Ports

| Port | Role | Adapter |
| --- | --- | --- |
| `AgentRunner` | run one agent attempt or turn in a directory, streaming events; may name itself (`name`), which labels its timeline entries; may declare `capabilities`; a request may resume a session (`resumeSessionId`) and carry a per-turn `profile`; a result may carry `meta` (command list, plan usage, model) | `agents/cursor`, `agents/claude` |
| `CheckRunner` | run a shell check or setup command | `checks/shell` |
| `Workspace` | worktree and branch per task, inspection, push | `vcs/git` |
| `PullRequests` | open pull requests | `vcs/github` |
| `RunStore` | persist runs (with a snapshot of the plan and the pid executing them), tasks, attempts, events | `storage/sqlite` |
| `RunReader` | read side for the web interface: runs list, snapshot of a run, events and agent events after an id, over a read-only connection that never writes or migrates | `storage/sqlite` |
| `TranscriptStore` | keep the raw agent stream | `storage/files` |

### Agent capabilities

`AgentRunner.capabilities` (`resume`, `chooseModel`, `commandList`, `visibleReasoning`, `planUsage`, all booleans) states what an adapter supports, so a caller asks the runner and never branches on its name. It is optional: `capabilitiesOf(runner)` returns all-false for a runner that declares none, which keeps simple runners and test fakes unchanged. A runner ignores request fields its capabilities do not cover.

`core/board` is data in, view model out: it takes the records a `RunReader` returns and builds what the page draws (see [web-interface.md](web-interface.md#read-side-and-board-view-model)). It imports only port types, so `web/` can `import type` it.

### Server

`src/server` is a driving adapter, like the CLI: it turns HTTP requests into calls on the `RunReader` port. It is built from small parts: `security.ts` (the guard every request passes), `router.ts` (method and path matching), `routes/<name>.ts` (one module per group of routes, each a function from the server's dependencies to a list of routes), `static.ts` (built app and SPA fallback) and `server.ts` (wires them on `127.0.0.1`). `lazy-reader.ts` wraps any `RunReader` for a database that does not exist yet. Details in [web-interface.md](web-interface.md#http-api).

## The web app

`web/` is outside the hexagon: it is a separate program with its own `web/tsconfig.json` (DOM, bundler resolution, no Node types) and its own build. Its only link to `src/` is `import type` through the `@board` alias, which points at `src/core/board/index.ts`; types are erased at build time, so no runtime code crosses over. `pnpm typecheck` checks both programs, `pnpm test` runs the web tests in a jsdom project next to the Node tests, and `pnpm build` writes the CLI to `dist/cli` and the app to `dist/web`. See [web-interface.md](web-interface.md#web-app-scaffold).

## Extending

- **Another agent** (for example Claude Code headless): implement `AgentRunner` under `adapters/agents/<name>/`, then choose it in `cli/commands/execute.ts`.
- **Another code host**: implement `PullRequests` under `adapters/vcs/<host>/`.
- **Another command**: add `cli/commands/<name>.ts`, route it in `cli/main.ts` and describe it in `cli/usage.ts`.
- **Another HTTP route**: add `server/routes/<name>.ts` and register it with one line in `server/routes/index.ts`; it sits behind the security guard automatically.
- **A new acceptance rule**: add a pure function under `core/verification/` and call it from `core/run/run-plan.ts`.

## Tests

Unit tests sit next to the module (`foo.ts`, `foo.test.ts`); fake binaries used by adapter tests live in a sibling `__fixtures__/` folder. `test/integration/` holds tests that need several real layers at once. Tests never touch the user's global git config or hooks: scratch repos disable hooks explicitly.

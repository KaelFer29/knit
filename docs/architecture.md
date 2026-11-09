# Architecture

Hexagonal: Knit's logic does not know which agent, git host or database it talks to. It only knows ports.

```
src/
  core/            pure logic, no I/O
    ports/           interfaces the core needs (AgentRunner, Workspace, RunStore, SessionStore, RunReader, SessionReader, ...)
    plan/            parse and validate a plan file
    prompt/          render the implementer prompt (and retry feedback)
    verification/    acceptance rules: scope of changed files, git hygiene
    timeline/        normalize each agent's raw stream (Cursor, Claude) into one readable timeline
    board/           pure view model of a run for the web interface (task states, queue, wires, totals)
    run/             the run loop, the verification of an attempt (shared with follow-ups), follow-ups on a task's chat, and pull request text
    chat/            run one turn of any agent in a session and record it (`runTurn`), agent-agnostic
  adapters/        implementations of the ports
    agents/cursor/   AgentRunner for the Cursor CLI
    agents/claude/   AgentRunner for Claude Code headless (`claude -p`, stream-json, resumable sessions); chosen by `knit chat`
    vcs/git/         Workspace (worktrees, branches, inspection, push)
    vcs/github/      PullRequests through the gh CLI
    checks/shell/    CheckRunner (bash)
    storage/sqlite/  RunStore and SessionStore (read-write), RunReader and SessionReader (read-only); one shared schema and migration (`schema.ts`)
    storage/files/   TranscriptStore (raw JSONL)
    system/          process spawning with timeouts and group kill; ProcessControl (inspect and signal processes)
  server/          driving adapter: HTTP API, live stream (SSE), run control, static files and the security guard of `knit ui`; receives a `RunReader`, a `TaskDiff`, a `FileActivity` and a spawner for Knit child processes, knows nothing about SQLite or adapters
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
| `AgentRunner` | run one agent attempt or turn in a directory, streaming events; may name itself (`name`), which labels its timeline entries; may declare `capabilities`; a request may resume a session (`resumeSessionId`) and carry a per-turn `profile`; a result may carry `meta` (command list, plan usage, model); may offer `listModels()` for a model picker | `agents/cursor`, `agents/claude` |
| `CheckRunner` | run a shell check or setup command | `checks/shell` |
| `Workspace` | worktree and branch per task, inspection, push | `vcs/git` |
| `PullRequests` | open pull requests | `vcs/github` |
| `RunStore` | persist runs (with a snapshot of the plan and the pid executing them), tasks, attempts, events | `storage/sqlite` |
| `SessionStore` | persist chat sessions (agent-agnostic), their turns (prompt, answer, tokens, profile, meta, pid) and each turn's timeline; list sessions newest first, events after an id | `storage/sqlite` |
| `TaskDiff` | read side of a task's code change: files, counts and hunks between its start commit and its commit, in its worktree | `vcs/git` |
| `FileActivity` | read side of the files a task worktree has changed now (git status), for the web interface; the files a timeline touched are derived in `core/timeline` | `vcs/git` |
| `SessionReader` | read side of the chat sessions for the web interface: sessions with turn counts and token totals, turns, timeline entries after an id; read-only, a database without session tables has none | `storage/sqlite` |
| `RunReader` | read side for the web interface: runs list, snapshot of a run, events and agent events after an id, over a read-only connection that never writes or migrates | `storage/sqlite` |
| `PlanDrafts` | read-only detection of the draft plans in `docs/plans/` of a repository (`PLAN_DIR`), each validated with the plan parser; used by the web interface | `system` |
| `TranscriptStore` | keep the raw agent stream | `storage/files` |
| `ProcessControl` | inspect and signal processes: is a pid alive, what is its command line, which process group it leads or contains, send a signal to a process or a group. Used by `knit abort`; every method is total (a gone process gives `false`/`undefined`) and pids 0 and 1 and the caller's own group are never signalled | `system` |

### Agent capabilities

`AgentRunner.capabilities` (`resume`, `chooseModel`, `commandList`, `visibleReasoning`, `planUsage`, all booleans) states what an adapter supports, so a caller asks the runner and never branches on its name. It is optional: `capabilitiesOf(runner)` returns all-false for a runner that declares none, which keeps simple runners and test fakes unchanged. A runner ignores request fields its capabilities do not cover.

`core/chat` runs one turn over the ports `AgentRunner`, `SessionStore` and a clock: it records the turn, runs the agent (passing `resumeSessionId` when the session has an agent session id and the runner's capabilities say it can resume; resuming with a runner that cannot is a `ChatError`, never silent), normalizes each raw event with the session's agent's normalizer (`ClaudeEventNormalizer` for `claude`, `AgentEventNormalizer` otherwise), stores each entry in `session_events` labelled with the agent, and stores the answer, tokens, exit code and `meta`, remembering the agent's own session id for the next turn. It flushes the normalizer and closes the turn even when the agent throws. `knit chat` calls it for free-standing sessions, and follow-ups (below) call it for their turn.

`core/run/verify-attempt.ts` is Knit's verification of one attempt (process, scope, git hygiene, changes, the task's checks), extracted from the run loop so a follow-up cannot drift from it; the run loop's behaviour is unchanged. `core/run/run-followup.ts` runs a follow-up: it checks the request before changing anything (the agent can resume, the session and its chat exist, the worktree is on disk), runs the turn through `runTurn` inside the task's worktree, verifies it with `verifyAttempt` against the task as the run's plan snapshot defines it, and records the next attempt, the task's status and commit, and the lifecycle events. The caller (`cli/commands/followup.ts`) decides what depends on the machine: whether the run's process is alive, which session holds the chat, which agent is built.

`core/board` is data in, view model out: it takes the records a `RunReader` returns and builds what the page draws (see [web-interface.md](web-interface.md#read-side-and-board-view-model)). It imports only port types, so `web/` can `import type` it.

### Server

`src/server` is a driving adapter, like the CLI: it turns HTTP requests into calls on the `RunReader` port. It is built from small parts: `security.ts` (the guard every request passes), `router.ts` (method and path matching), `routes/<name>.ts` (one module per group of routes, each a function from the server's dependencies to a list of routes), `static.ts` (built app and SPA fallback) and `server.ts` (wires them on `127.0.0.1`). `routes/control.ts` holds the run control routes, which start Knit commands through a `Spawner` injected by `cli/commands/ui.ts` (the server never spawns, imports an adapter or touches signals itself; `knit abort` uses the `ProcessControl` port). `routes/sessions.ts` serves chat sessions from a `SessionReader` and starts turns by spawning `knit chat` (the agents' capabilities arrive as `AgentInfo` from the composition root). `lazy-reader.ts` wraps any `RunReader` for a database that does not exist yet. Details in [web-interface.md](web-interface.md#http-api).

## The web app

`web/` is outside the hexagon: it is a separate program with its own `web/tsconfig.json` (DOM, bundler resolution, no Node types) and its own build. Its only link to `src/` is `import type` through the `@board` alias, which points at `src/core/board/index.ts`; types are erased at build time, so no runtime code crosses over. `pnpm typecheck` checks both programs, `pnpm test` runs the web tests in a jsdom project next to the Node tests, and `pnpm build` writes the CLI to `dist/cli` and the app to `dist/web`. See [web-interface.md](web-interface.md#web-app-scaffold).

## Extending

- **Another agent** (for example Claude Code headless): implement `AgentRunner` under `adapters/agents/<name>/`, then choose it in `cli/commands/execute.ts`.
- **Another code host**: implement `PullRequests` under `adapters/vcs/<host>/`.
- **Another command**: add `cli/commands/<name>.ts`, route it in `cli/main.ts` and describe it in `cli/usage.ts`.
- **Another HTTP route**: add `server/routes/<name>.ts` and register it with one line in `server/routes/index.ts`; it sits behind the security guard automatically.
- **A new acceptance rule**: add a pure function under `core/verification/` and call it from `verifyAttempt` in `core/run/verify-attempt.ts`, which the run loop and follow-ups share.

## Tests

Unit tests sit next to the module (`foo.ts`, `foo.test.ts`); fake binaries used by adapter tests live in a sibling `__fixtures__/` folder. `test/integration/` holds tests that need several real layers at once. Tests never touch the user's global git config or hooks: scratch repos disable hooks explicitly.

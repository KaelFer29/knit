# Web interface

`knit ui` is a local web app on `127.0.0.1` that joins Claude and Cursor into one workflow and is the single place to review everything. It is built as one interactive view (see [Single view](#single-view)): Claude, Knit and Cursor joined by a live pipeline, with runs, sessions, the file explorer and the configuration editor opening in a side panel. Known limits are listed at the end. Progress is tracked in [../odd/tasks/web-interface.md](../odd/tasks/web-interface.md).

## Workflow

```
 1. Plan with Claude          2. Orchestrate with Knit         3. Implement with Cursor
 conversation, any topic  ─►  plan validated, user launches ─► one task at a time, verified
 (most turns end here)        queue, checks, retries, PRs       in its own worktree
```

- **Planning is a conversation.** A Claude session runs in the target repository with the user's own Claude configuration (CLAUDE.md, rules, skills, MCP servers), so it behaves like a terminal session. Most turns never leave this stage.
- **The handoff is explicit.** Only development with a finished plan moves on. Claude writes a plan in the [plan format](plan-format.md) and validates it; the interface shows it as a draft and the user launches it. A Claude turn never starts a run by itself.
- **Tokens go where they pay off.** Claude reasons and plans; Cursor implements from self-contained prompts with no memory MCP; Knit's checks are deterministic and never call a model. Token usage is shown per agent for every turn, attempt, session and run.

The work is organised in five phases. Status of each:

| Phase | Adds | Status |
| --- | --- | --- |
| A | live view of runs, run control (start a plan, abort, resume, retry a task) and each task's diff | built |
| B | workspace: persistent sessions with live timeline, per-turn profile, command palette, usage panel, plan handoff; live file activity for task attempts | built, except file activity in the workspace |
| C | Cursor sessions: follow-ups on a task's chat inside its worktree, verified again by Knit | built in the CLI (`knit followup`); not started from the interface |
| D | configuration editor for the files both CLIs read, with a diff before saving | built |
| E | read-only file explorer for the repository and task worktrees | built |

## Agents and sessions

One model serves every agent: a **session** is a conversation with one agent, a **turn** is one prompt and its answer, and every turn produces timeline events. Each agent adapter declares its **capabilities**, and the interface renders from them, never from the agent's name. Adding an agent means writing its adapter and its identity.

| Capability | Claude | Cursor |
| --- | --- | --- |
| resume a session | yes (`--resume`; verified, the session id stays the same) | yes (`--resume <chatId>`; verified, the chat id stays the same) |
| choose the model | yes (`--model`) | yes (`--model`; the ids come from `agent models`) |
| command list | yes (`system/init.slash_commands` minus `terminal_slash_commands`) | no (verified: the headless CLI has no command list; a slash command sent with `-p` reaches the model as plain text) |
| visible reasoning | no (blocks arrive empty, with only a signature) | yes |
| plan usage | yes (`rate_limit_event`: 5-hour and 7-day windows, utilization 0 to 1) | no (verified: neither the stream nor `agent about` / `agent status` reports plan usage or quota) |

The port declares these as `AgentCapabilities` on each runner (`src/core/ports/agent-runner.ts`); `capabilitiesOf(runner)` returns all-false for a runner that declares none. The Claude adapter (`src/adapters/agents/claude/`) declares resume, model, command list and plan usage as supported and reasoning as not visible. The Cursor adapter declares resume, model choice and visible reasoning as supported, and the command list and plan usage as not. A runner may also offer `listModels()` to fill the model picker: Cursor asks `agent models`, Claude returns a static list (`sonnet`, `opus`, `haiku`, `fable` and the full ids seen in real streams), because asking the CLI would be a real call. The per-turn profile maps to flags one to one: `--model`, `--effort`, `--permission-mode`.

**What was verified against the real Claude CLI (2.1.319, headless `-p`, subscription auth):**

- **Slash commands through `-p`.** `/usage` sent as the prompt does not call the model: the stream holds one synthetic assistant message (model `<synthetic>`) with the command's text, and a `result` with `num_turns: 0` and zero tokens; there is no `rate_limit_event`. `/context` was not tried. So a slash command can be sent as a prompt and its answer is plain text, but Knit cannot read structured numbers from it: the `/usage` panel is built from `rate_limit_event` and `result.usage` instead (D9). Commands that only make sense in a terminal are listed in `terminal_slash_commands` and are left out of the palette.
- **Resume.** `claude -p --resume <id> "<prompt>"` continues the same conversation (the agent recalled what the first turn asked) and the session id does not change: every event and the `result` carry the id given.
- **Interactive resume of a `-p` session** (`claude --resume <id>` in a terminal) cannot be tested headless, so it is not verified. D10 relies on it, which stays an assumption until someone tries it by hand.
- **Reasoning.** Headless Claude emits `thinking` blocks with an empty text; the timeline marks them as "not shared by the agent". The two short calls made to see one (a haiku-class model, with and without `--effort high`) produced no thinking block at all, so the empty-block shape comes from the design brief, not from a recorded stream.
- **Configuration.** By default the adapter does not pass `--bare` or `--strict-mcp-config`, so the session uses the user's own CLAUDE.md, rules, skills, hooks and MCP servers (D6). Hooks run even with `--strict-mcp-config`: it only ignores configured MCP servers. A prompt is passed after `--` so one that starts with a dash is not read as a flag.
- **Tokens.** `inputTokens` is `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` of the final `result`, and its usage is cumulative over the requests of the turn, so a turn that calls tools counts the cached prompt once per request. The timeline entry keeps the cache parts apart.

**What was verified against the real Cursor CLI (`agent` 2026.11.05, headless `-p`, subscription login, four calls at most in a scratch repository with `composer-2.5-fast`):**

- **Chat id and resume.** The `system/init` event and the final `result` event both carry the chat id as `session_id` (the `user`, `thinking` and `assistant` events carry it too). `agent -p --force --output-format stream-json --resume <chatId> "<prompt>"` continues the same conversation (the agent recalled a word given in the first turn) and every event of the resumed turn carries the same id. A sanitized recording of both turns is `src/adapters/agents/cursor/__fixtures__/stream-resume.jsonl`. `agent create-chat` also exists and returns a new empty chat id; Knit does not need it, because the first turn's id is read from the stream.
- **Command list.** None headless. `agent --help` lists subcommands (`models`, `about`, `status`, `ls`, `resume`, `create-chat`, ...), not slash commands, and the init event has no `slash_commands`. A prompt of `/usage` sent with `-p --resume` was not handled by the CLI: it reached the model, which went looking in the repository for what the command means and answered in prose. So `commandList` stays false, and Cursor's palette only has the Knit-native commands (`/clear`, `/model`, and `/usage`, which says it is not reported).
- **Plan usage.** None. `agent about --format json` returns the CLI and OS version, the model, the subscription tier and the account email (nothing about quota); `agent status --format json` returns only the authentication state. The stream's `result.usage` is `inputTokens`, `outputTokens`, `cacheReadTokens` and `cacheWriteTokens`: tokens of the turn, no windows and no limits. So `planUsage` stays false, and the usage panel for Cursor can show tokens per turn only.
- **Models.** `agent models` (also `agent --list-models`) prints a title line, one `<id> - <label>` line per model (274 lines in this account, including a current default marked `auto - Auto (current, default)`), a blank line and a tip. Some labels end in zero-width spaces. `listModels()` keeps the ids only. Ids are account-specific and change often, so the list is read when the picker opens, never hard-coded.
- **Tokens.** On a resumed turn most of the prompt is served from cache: the second turn reported `inputTokens: 93` and `cacheReadTokens: 12288`. The adapter records `inputTokens` and `outputTokens` only, so a turn's cached input is not counted for Cursor, unlike Claude's (see Tokens above). Not changed here; it is an open point for the token views (S13).

- **Follow-ups on a task (phase C).** `knit followup <run-id> <task-id> "<prompt>"` resumes the Cursor chat of the task's latest attempt inside the task's own worktree and has Knit verify the result again against the plan snapshot of the run (`runs.plan_text`), exactly as for an attempt of the run loop. The turn lands in a session (one per chat, in the worktree, titled after the run and task) and the outcome is the task's next attempt, with the lifecycle events (`followup.started`, `attempt.started`, `check.started`, `attempt.finished`, `followup.finished`). It refuses while the run's process is alive. It is a CLI command only: no HTTP route starts it, so the interface shows its results (the attempt and the session) but cannot trigger one. Details in [run-lifecycle.md](run-lifecycle.md#follow-ups).
- **Command palette.** Built from the agent's own list, so it follows every CLI update. Session commands are handled by Knit: `/clear` starts a new session, switching chats uses the session list, `/model` sets the turn profile, `/usage` opens the usage panel and, for an agent that reports plan usage, sends `/usage` as a turn so its answer shows in the session (otherwise the interface says the agent does not report it). Any other command is sent to the agent as the prompt.
- **Continue in a terminal.** Every session shows the command that continues it (`claude --resume <id>`, `agent --resume <chatId>`). Knit does not try to match each agent's own interface; whatever it lacks stays one copy away.

## Files

- **Task diff (built, T6):** each task's diff, from its start commit to its last commit (or to the worktree while it has none).
- **Task attempts (built, T14):** the files each attempt touched, from the paths of its timeline's file tool calls (`Read`, `Edit`, `Write`, `NotebookEdit` and Cursor's `args.path`; search and listing tools are skipped), plus the task worktree's `git status`. The derivation is the pure `touchedPaths` in `src/core/timeline/file-activity.ts`, confined to the worktree (`confinePath`: relative, no `..`, no backslash or NUL, absolute paths only inside the worktree). The worktree list comes from the `FileActivity` port (`GitFileActivity`, which reuses the scope check's `listChangedPaths`). The task detail panel shows both. The workspace does not show them: session-level file activity is not done.
- **File explorer (built, T17):** a read-only explorer for the repository and the task worktrees (`FileTree` port, `FsFileTree` adapter, routes above). The root directory always comes from the run record, never from the request. Every path is confined to its root: `..`, absolute paths, NUL, backslashes, any `.git` segment (in any letter case, at any depth) and symlinks that resolve outside the root or into a `.git` directory are `403`; `.git` directories are not listed. A file is opened without following links and without blocking, and judged on the open descriptor, so a file swapped for a link or a FIFO after the check is refused. The page (`web/src/containers/FilesView.tsx`, `organisms/FileExplorer.tsx`) lives in the Files tab of the Cursor panel (built-in sample files for fixtures): a root switcher, a lazily loaded tree and a text viewer that renders contents as plain text, with a note for binary and oversized files. It is the Files tab of the Cursor panel.

## Process model

```
            ┌──────── spawns (detached) ────────┐
            │                                   ▼
 browser ◄──┤ knit ui ──reads (readonly)──► ~/.knit/knit.db (WAL) ◄──writes── knit run / knit resume
  JSON+SSE  │ 127.0.0.1                         ▲
  POST cmds └─── spawns (phases B, C) ──► knit chat → claude -p / agent -p --resume ──writes──┘
```

- `knit ui` is a separate, long-lived process. It **reads** the database through a read-only connection; only the processes it starts write. WAL lets it read while they write.
- Runs stay one-shot processes. The server starts `knit run` or `knit resume` as detached children (their own process group, so they survive the interface being closed) and stops a run by starting `knit abort <id>`, which signals the pid recorded in `runs` after checking that it really is that run. The server itself never signals anything.
- A prompt from the interface becomes one `knit chat` process: it runs one agent turn, records the turn and its timeline, and exits. The server never writes the database itself.
- Claude is driven through `claude -p --output-format stream-json --verbose --resume`, which uses the subscription. The Agent SDK is not used: its documentation expects API key authentication.
- It binds to `127.0.0.1` only. Agent output contains file contents and paths, and the server can launch agents, so it is never served on the network.
- Live updates use Server-Sent Events. Every table the page follows has an increasing `id`, which maps directly to SSE's `Last-Event-ID`: a reconnecting browser resumes exactly where it stopped.
- The server polls SQLite (about every 500 ms, like `knit logs --follow`) and pushes only new rows. There is no change notification in SQLite across processes, so polling is the honest mechanism.

## Layers

The interface follows the same hexagonal rule as the rest of Knit.

```
src/
  core/
    ports/                  read side: run-reader, session-reader, task-diff, file-activity, file-tree,
                            config-files, plan-drafts (process-control is used by `knit abort`, not the server)
    board/                  pure: records → board view model (nodes, wires, queue, task blocks)
  adapters/
    storage/sqlite/         RunReader and SessionReader (readonly connections)
    vcs/git/                TaskDiff and FileActivity
    system/                 FileTree, ConfigFiles, PlanDrafts, ProcessControl
  server/                   driving adapter: HTTP routes, SSE stream, static files, security guard
  cli/commands/ui.ts        wires the adapters into the server; the only place adapters are chosen
web/                        browser app (Vite + React + TypeScript), built to dist/web
```

- `core/board` turns raw records into what the page draws. It is pure, so the visual states (queued, running, retrying, verifying, delivered) are unit-tested without a browser.
- `server` knows HTTP and SSE, not SQLite. It receives a `RunReader`; `cli/commands/ui.ts` builds it (read-only, opened once the database exists).
- `web` never talks to SQLite or the file system; it only consumes the HTTP API. Inside it: container components fetch and subscribe, presentational components only render props (atomic design: atoms, molecules, organisms).

## Read side and board view model

Built in task T2. Two pieces: a port that reads the database, and a pure function that turns what it returns into the model the page draws.

### `RunReader` port

`src/core/ports/run-reader.ts`, implemented by `SqliteRunReader` (`src/adapters/storage/sqlite/run-reader.ts`) over a connection opened with `readonly: true` and `fileMustExist: true`. It never writes, never migrates and never changes `user_version`. It reads while another process writes (WAL), and an older database (schema 3) is read as it is: the columns added by schema 4 are absent and the matching fields stay absent on the returned records (timeline rows from before schema 4 report `agent: "cursor"`, as documented in [data-model.md](data-model.md)).

| Method | Returns |
| --- | --- |
| `listRuns()` | `RunListItem[]`, newest first: the run, `taskCounts` (`total`, `pending`, `running`, `passed`, `failed`) and `inputTokens` / `outputTokens` summed over its attempts |
| `getRunSnapshot(runId)` | `RunSnapshot` (run, tasks, attempts, lifecycle events, `lastEventId`, `lastAgentEventId`) read from one consistent point in time, or `undefined` for an unknown run |
| `getRun(runId)` | the `StoredRun` alone, or `undefined`: the cheap read for a status check |
| `getLatestAgentEvents(runId, limit, { taskId?, attempt? })` | the newest `limit` agent events, oldest first |
| `getEventsAfter(runId, afterId, limit?)` | lifecycle `events` with `id > afterId`, oldest first |
| `getAgentEventsAfter(runId, afterId, { taskId?, attempt?, limit? })` | `agent_events` with `id > afterId`, oldest first, optionally for one task or one attempt |

Every row of the two incremental tables carries its numeric `id`, so a caller resumes exactly where it stopped by passing the last id it saw (`lastEventId` and `lastAgentEventId` of a snapshot are the first resume points). The server turns those ids into SSE ids.

### `BoardModel`

`buildBoard({ run, tasks, attempts, events, agentEvents?, nowMs? })` in `src/core/board/` is pure: it imports nothing from Node or from adapters, never reads a clock (`nowMs` is passed in) and `web/` imports only its types. `agentEvents` is only read for the live line, so a recent window of the timeline is enough.

| Field | Content |
| --- | --- |
| `nodes.claude` | `status` (always `done`: the plan was handed over), `planName`, `taskCount`, `hasPlanText` |
| `nodes.knit` | `status`, `activeTaskId?` |
| `nodes.cursor` | `status`, `activeTaskId?`, `attempt?` (only while the agent itself works) |
| `wires` | `plan` (claude to knit, one strand per task), `prompt` (knit to cursor, one strand per task that was dispatched) and `result` (cursor to knit, one strand per task with a finished attempt); each with `active` and its `strands` (`taskId`, `state`) |
| `queue` | queued tasks in execution order (`position`), each with its `dependsOn` |
| `active` | the task being worked on: `taskId`, `title`, `state` (`running`, `retrying` or `verifying`), and the open `attempt` with its start time |
| `delivery` | delivered tasks in execution order with `branch`, `commitSha` and `prUrl` |
| `tasks` | every task: `state`, `position`, `goal?`, `dependsOn?`, `specs` (empty when unknown), branch and commit fields, `failureReason?`, `attempts`, `tokens`, `durationMs` |
| `tasks[].attempts[]` | `attempt` (0 is setup), `status` (`running`, `verifying`, `passed`, `failed`, `interrupted`), `startedAt`, `durationMs`, tokens, `failedCheck?`, `scopeOk?` (the scope verdict), `checking?` |
| `totals` | `tokens` per node (`claude`, `knit`, `cursor`), `elapsedMs`, `agentMs`, `attempts`, task counts per state |
| `liveLine` | what is happening right now: `source`, `kind`, `text`, `ts`, `eventId?` |

Runs created before schema 4 have no goal, specs, position, dependency or plan text. The model keeps the creation order as the position, returns `specs: []` and leaves `goal` and `dependsOn` absent and `hasPlanText` false, so they draw without a special case.

### State mapping

An attempt row is written only when the attempt ends, so a running attempt is known from lifecycle events: it is **open** when it has an `attempt.started` event and neither an `attempt.finished` event nor an attempt row. A repeated `attempt.started` for the same number (a resumed run reuses the number of an attempt that never finished) restarts it.

| Task state | When |
| --- | --- |
| `queued` | task status `pending`. Tasks skipped after a failure stay queued |
| `running` | task status `running`, run `running`, no check started in the open attempt and no earlier attempt (number 1 or more) failed. Includes setup and the moments before the first attempt |
| `retrying` | task status `running`, run `running`, and an attempt numbered 1 or more has failed: the open attempt, or the gap before the next one, is a retry. A failed setup (attempt 0) fails the task, so it never counts |
| `verifying` | the open attempt has a `check.started` event: the agent finished and Knit runs the checks. It wins over `retrying` |
| `delivered` | task status `passed` |
| `failed` | task status `failed`, or task status `running` while the run is no longer `running` (the run died mid-task; its open attempt shows as `interrupted`) |

Nodes and wires follow from that. Knit is `working` while the run runs, `done` when it passed and `failed` when it failed. Cursor is `working` only while an open attempt is `running` (idle while Knit verifies or between attempts) and takes the run's final status when it ends. The `plan` wire is active while the run runs and tasks are still queued, `prompt` while the agent works and `result` while Knit verifies. Tokens of attempts are the builder agent's: `totals.tokens.cursor`; Knit never calls a model, and Claude's sessions are not attempts, so their totals stay zero until phase B records them.

The live line is the newest agent event of the open attempt while the agent works (a tool call reads `read: src/a.ts`, other kinds show their text clipped to 160 characters) and the check command, attributed to `knit`, while the attempt is verifying. It is absent when the run is not running, when no attempt is open or when the attempt has no events yet.

## `knit ui`

Built in task T3.

```
knit ui [--port <n>] [--data-dir <dir>]
```

| Option | Does |
| --- | --- |
| `--port <n>` | port to listen on, default `4317`; `0` picks a free one. A busy port stops with `Port <n> is already in use` and exit code 1; a malformed one is a usage error (exit code 2) |
| `--data-dir <dir>` | where `knit.db` lives (default `~/.knit`, or `$KNIT_HOME`), like the other commands |

Built-in run control (T8) starts the commands as children of the compiled CLI next to it, so it needs `pnpm build` first; from a source checkout without `dist/cli` the server is read-only (see [Run control](#run-control)).

It prints one line, `http://127.0.0.1:<port>/?token=<token>`, and keeps running until `SIGINT` or `SIGTERM`, then closes its connections and exits with 0. It never opens a browser: open the address yourself. The host is not configurable. If `knit.db` does not exist yet, the server still starts (the runs list is empty) and opens the database, read-only, as soon as `knit run` creates it.

## Web app scaffold

Built in task T4: the skeleton of the browser app with its look and its identities. The pages above it are built on it.

| Piece | Where | Notes |
| --- | --- | --- |
| App | `web/` (Vite 7, React 19, TypeScript) | `web/index.html` is the entry; builds to `dist/web` |
| Design tokens | `web/src/styles/tokens.css` | CSS custom properties: neutral surfaces and text, status colors (queued, running, retrying, verifying, delivered, failed), agent colors, type scale, spacing, radius, elevation, motion durations |
| Themes | `tokens.css`, `web/src/theme/` | Light by default, dark under `prefers-color-scheme`, and `data-theme="light"` or `"dark"` on `<html>` overrides the system. The toggle offers light, dark and system and stores the choice under the `localStorage` key `knit.theme` (every storage access is guarded; the page works when storage is blocked). The stored theme is applied in `main.tsx` before the first render |
| Identities | `web/src/identity/agents.ts` | Claude (planner), Knit (orchestrator) and Cursor (builder): label, role, brand color tokens, logo file, monogram. Components receive an identity and never branch on the agent's name |
| Logo | `web/src/atoms/Logo.tsx` | Loads `/brand/<file>`; shows the monogram while it loads and keeps it when the file is missing or fails. Knit's own mark (`atoms/KnitMark.tsx`, two interlocked threads) is drawn in code |
| Shell | `web/src/App.tsx`, `organisms/AppShell.tsx` | Header with the Knit mark and name and the theme toggle; skip link; `main#canvas`, which hosts the flow canvas through the `FlowView` container |
| API client | `web/src/api/client.ts` | `apiGet` with same-origin credentials and `ApiError`, used by every container that fetches |
| Fixtures | `web/src/fixtures/boards.ts` | Typed `BoardModel` samples (running, retrying, verifying, failed, delivered, a long queue, and a run from before schema 4) that the canvas is drawn from until it is wired to live data |

Scripts (all from the repository root):

| Script | Does |
| --- | --- |
| `pnpm dev:web` | Vite dev server on `127.0.0.1`, with `/api` proxied to `http://127.0.0.1:4317` |
| `pnpm typecheck` | `tsc --noEmit` for `src/` and `test/`, then for `web/` (`web/tsconfig.json`) |
| `pnpm test` | Vitest with two projects: `node` (`src/**`, `test/**`) and `web` (`web/src/**/*.test.{ts,tsx}`, jsdom) |
| `pnpm build` | `tsc -p tsconfig.build.json` (CLI to `dist/cli`), then `vite build` (app to `dist/web`). `prebuild` clears `dist` first |

The web dependencies (React, Vite, jsdom, Testing Library, `playwright-core`) are all dev dependencies: the app is bundled into static files, so the installed CLI needs none of them. Vite 7 needs Node 20.19 or newer, stricter than the package's `engines` (`>=20`); the CLI itself still runs on any Node 20.

To look at the app, run `pnpm build`, serve `dist/web` and take screenshots with the installed Chromium through `playwright-core` (`executablePath` of the Playwright cache, `--no-sandbox`).

### Logo files

The app asks for exactly these files and never commits them:

| Identity | File | Notes |
| --- | --- | --- |
| Claude | `web/public/brand/claude.svg` | the official mark, in its own colors |
| Cursor | `web/public/brand/cursor.svg` | a single-color mark drawn dark; the app inverts it to light in the dark theme |
| Knit | none | original mark drawn in code |

`web/public/brand/` is git-ignored; Vite serves it at `/brand/` and copies it into `dist/web/brand/` on build. A missing or unreadable file leaves the monogram in place.

## Flow canvas (built)

Built in task T5 on fixtures, then connected to live data in T7 (see [Live data in the page](#live-data-in-the-page)): the circuit described in [Visual model](#visual-model).

| Piece | Where | Notes |
| --- | --- | --- |
| `FlowView` (container) | `web/src/containers/FlowView.tsx` | Picks the board and the pulses and hands them down. With `?run=<id>`: that run's board from `useBoard` and the pulses from its events. Otherwise a fixture from `?fixture=<name>` and the demo pulses from `?demo=1` |
| `FlowCanvas` | `organisms/FlowCanvas.tsx` | Lays out Claude, Knit and Cursor and draws the board it is given, plus the pulses it is given. Presentational |
| `AgentBlock` | `organisms/AgentBlock.tsx` | One identity block: logo (through `Logo`, with the monogram fallback), label, role, status badge from the node status, token total and, for the builder, the single live line. Renders from props and the identity, never from the agent's name |
| `QueueLane`, `ActiveTask`, `DeliveryLane` | `organisms/` | Knit's input (queued tasks in execution order, a connector between neighbours that depend on each other, a fold behind "Show N more" past six), center (the running task, or the failed one, with its stage and the check being run) and output (a commit chip and a pull request chip per delivered task) |
| `TaskCard` | `molecules/TaskCard.tsx` | Position, title, state, attempt count and the `Depends` link |
| `Wires` | `organisms/Wires.tsx` | The SVG overlay: strands, ports and pulses |
| Geometry | `flow/geometry.ts` | `computeWires` is a pure function from the measured block rectangles to strand paths and ports (unit tested). `FlowCanvas` measures with a `ResizeObserver` (`flow/useFlowLayout.ts`) and recomputes whenever the canvas or any block changes size, so opening a block moves the wires with it |

**Wires.** One strand per task from Claude to Knit (a ribbon that lands on the queue), one per dispatched task from Knit to Cursor (the prompt) and one per finished attempt back (the result), as smooth curves on two parallel lanes. A wire that carries nothing yet keeps an idle, dotted lane so the circuit stays connected. Strands are neutral while queued or delivered and take the status color while a task is running, retrying, verifying or failed; the strand of the open task flows (marching dashes).

**Pulses.** `FlowCanvas` takes `pulses: { id, wireId, kind }[]` with `kind` one of `dispatched` (plan wire), `prompt` or `result`, and `wireId` a strand (`prompt:T3`) or a bare wire. A dot travels the strand in the color of the sender and `onPulseEnd(id)` fires when it arrives; the owner drops it. Under `prefers-reduced-motion` the dot becomes a static highlight of the strand that clears after about two seconds, and every other animation is off. Demo mode (`?demo=1`, marked "Demo pulses: on" in the switcher) plays dispatch, prompt and result in turn on the fixture; it is `flow/useDemoPulses.ts` and exists only to see and screenshot the motion.

**States.** Each task state has its own icon and text label, so color is never the only signal: queued (dashed ring), running (turning arc, the only state with life: a soft halo on the running card), retrying (circular arrow), verifying (checklist), delivered (check) and failed (cross). Blocks borrow the same look for their node status (idle, working, done, failed).

**Expandable blocks.** Blocks, task cards and the running task are disclosure widgets: a focusable `<button>` with `aria-expanded` and `aria-controls`, toggled by Enter and Space. The open panel is the `renderDetail(target)` slot, with `target` either `{ kind: "agent", id }` or `{ kind: "task", taskId }`; it is called only while open. With nothing to render the panel shows a tidy empty state. The detail content is described in [Detail panels](#detail-panels-built).

**Layout.** From a canvas width of 1120 px (a 1280 px window) the three blocks sit side by side; below it the same flow runs top to bottom (Claude, Knit, Cursor) with the wires recomputed, and nothing scrolls horizontally down to 768 px. The orientation is chosen in one place from the measured width and written to `data-layout`. Tab order follows the reading order: Claude, Knit, its queue, the running task, the delivered links, Cursor.

**Viewing the fixtures.** `pnpm dev:web` (or a built `dist/web` served statically), then open `/?fixture=runningRun`. A switcher with the fixtures appears only when `fixture` is in the URL: `runningRun` (the default without the parameter), `retryingRun`, `verifyingRun`, `failedRun`, `deliveredRun`, `longQueueRun` and `legacyRun`. Add `&demo=1` for the pulses.

### Live data in the page

Built in task T7. `?run=<id>` draws a real run; with no `run` the page keeps showing the fixtures.

| Piece | Where | Notes |
| --- | --- | --- |
| `useBoard(runId)` | `web/src/live/useBoard.ts` | Container hook. Fetches `GET /api/runs/:id` (the server derives the board), opens the stream right after that snapshot (`?after=<lastEventId>.<lastAgentEventId>`) and refetches the board at most every 400 ms while rows arrive. Returns `board`, `connection`, `error`, `pulses`, `onPulseEnd`. Closes the stream on `done` (after one last refetch) and on unmount |
| `openRunStream` | `web/src/api/stream.ts` | `EventSource` wrapper for `event`, `agent_event` and `done`. It remembers the last message id; if the browser keeps retrying it sends `Last-Event-ID` itself, and if the browser gives up (`readyState` closed) the wrapper reopens with `?after=<last id>` after a growing delay (1 s up to 15 s). No gap, no duplicate |
| `pulseForEvent` | `web/src/live/pulses.ts` | `task.started` pulses the plan wire (`dispatched`), `attempt.started` the prompt wire and `attempt.finished` the result wire, each on the task's strand. Other events make no pulse |
| `LiveStatus` | `web/src/molecules/LiveStatus.tsx` | One quiet line: loading, "reconnecting", or the load error. Silent while everything works |

Reduced motion is handled by the canvas (static highlight instead of a travelling dot), so live pulses need nothing extra. `RunReader` gained `getRun(runId)` (the run row alone, used by the stream for its status check instead of a full snapshot) and `getLatestAgentEvents(runId, limit, { taskId?, attempt? })` (the newest rows, oldest first; `GET /api/runs/:id` reads 20 of them for the live line instead of the whole attempt).
## Runs list and run control (built)

Since the single view, the runs list, the picker, the start form and run control live in the [Knit panel](#single-view); there are no `#/runs` pages. A run is selected by `?run=<id>`, by the panel's picker (`selectRun`), or is the most recent one.

- **Control** (`RunControlBar`, `RunControls`): on a running run, "Abort" asks for confirmation first; on a failed run, "Resume" and one "Retry <task>" per failed task. Passed runs show nothing. A refused command (409, 502, 504, 503 without a build) shows the server's message; accepted ones show a short note, and the board follows through the stream.
- **Start.** The form posts `POST /api/runs` (absolute plan path, `Push`, `Open PRs`, max attempts). The server's reason (including the plan issues) is shown on error; on success the new run is selected.

**Knit panel (single view).** The panel (`web/src/single/panels/knit/`) shows, top to bottom: the run summary (plan, status, progress bar, builder tokens, elapsed time); run control (live runs only); the task queue in order, each task a `TaskCard` that opens its attempts, scope, checks, verdicts and retry feedback through `renderDetail`; a "Start a run" form; and the runs picker. A row of the picker is a button (`aria-current` on the shown run) that calls `selectRun(runId)`; "Latest" calls `selectRun(undefined)`; a started run is selected automatically. Up, Down, Home and End move between rows. Empty, loading and error states are kept. What selects a run: the picker (`selectRun`), `?run=<id>`, or the legacy `#/runs/<id>` hash that the shell still reads; the panel itself no longer links to it.

## Detail panels (built)

Built in task T6 on top of the flow canvas: the `renderDetail` slot of every disclosure widget is filled by `containers/detailRenderer.tsx`. What a panel needs beyond the board comes from a `DetailSource` (`web/src/detail/types.ts`): `createApiDetailSource` reads the attempts' notes from the run snapshot and fetches the timeline and the diff lazily; `fixtures/detail.ts` supplies samples for the fixtures. A panel is mounted only while open, so nothing is fetched for a closed block. With `?run=<id>` the page uses the API source, fed by the snapshot that `useBoard` keeps current; without it, the fixture source.

| Block | Panel |
| --- | --- |
| Claude | the plan text (plain text; a run recorded before schema 4 says it stored none) and the specs of every task |
| Knit | per task and attempt: the setup command, the verdicts on checks, scope and the commit history, the feedback sent to the agent for the next attempt (derived from the failed attempt before it) and the last lines of the recorded output |
| a task (queue, active task, or a delivered task opened from the delivery lane) | its goal, every attempt with its verdicts, the agent timeline and the files it touched (loaded when the attempt opens), "Changes": the diff from `GET /api/runs/:id/tasks/:task/diff`, one expandable section per file, and "Worktree changes": what the worktree's git status lists now (from `GET /api/runs/:id/tasks/:task/activity`) |
| Cursor | the side panel (`single/panels/cursor/CursorPanel.tsx`), see below |

**Cursor panel (built, U5).** Two tabs. *Agent*: the active task first (the latest task when none is active), as a card with its goal and attempts; the running or verifying attempt opens by itself and its timeline reloads every 3 s while it is open (a failed refresh keeps what was shown). Each attempt shows the model the agent reported in its session entry (when there is none, no model is shown), the agent timeline with tool calls and messages, the files it touched, and the task's "Changes" (diff, one expandable section per file) and "Worktree changes". The other tasks follow as collapsed rows with their state; opening one loads its detail. *Files*: the explorer of the repository and the task worktrees (live run) or the demo tree (fixtures). Everything is drawn from the detail source and the board, never from the agent's name, and agent output renders as text.

Gaps: Knit stores only the failed check's command, not its output, so the "check output" is shown for the setup command only; the retry feedback is rebuilt from the verdicts, not read from a stored prompt. The agent output, the plan and the patch always render as text (never as markup).

## Workspace (built)

Built in task T12: the sessions of any agent in one place (S10, S13, S16, D5, D8 to D10). The workspace is now Claude's side panel in the [single view](#single-view) (see [Claude panel](#claude-panel)); the page and its `#/workspace` routes are gone. Everything it shows comes from the [session routes](#sessions); nothing in `web/` checks an agent's name. An agent the interface has no brand for gets a neutral monogram identity (`identityOf`), so a new adapter appears without a change to the components.

| Piece | Where | Notes |
| --- | --- | --- |
| `ClaudePanel` (container) | `single/panels/claude/ClaudePanel.tsx` | Fetches agents, the session list (every 3 s) and the open session, owns the composer's choices (per-agent profile, directory), starts turns and hands everything to presentational components |
| `useSessionLive` | `sessions/useSessionLive.ts` | Keeps one session current: its record and turns plus the timeline entries after the last id it holds (no gap, no repeat). About every 0.8 s while a turn runs, every 4 s otherwise. It polls instead of using SSE: sessions have their own id sequence and one session is a few rows; the run stream stays SSE |
| `NewSessionHeader` | `organisms/` | Title, agent and directory plus the "Continue in terminal" command with a copy button (only when the server sent `continueCommand`); or one radio per agent the server lists and the directory field |
| `UsagePanel`, `UsageMeter` | `organisms/`, `molecules/` | Session tokens (summed over its turns) and one bar per plan window in `meta.planUsage`, with the percentage written out and the reset time. An agent whose `planUsage` capability is false gets "This agent does not report plan usage." instead of bars. Toggled by the Usage button or `/usage` |
| `Timeline`, `TimelineEntry` | `organisms/`, `molecules/` | The shared timeline: prompt, messages, reasoning, tool calls (arguments and result, paired by call id), the closing result with duration and tokens, and a working marker. Reasoning is shown when present and as "Reasoning not shared by the agent" otherwise (S8). Output is only ever text. `sessions/timeline.ts` builds the items from turns and events (pure, unit tested) |
| `Composer`, `CommandPalette`, `ProfileBar` | `organisms/`, `molecules/` | Prompt field (Enter sends, Shift+Enter adds a line) with the palette that opens on a lone `/word`, and the per-turn profile |

**Command palette (D9).** `paletteCommands` builds it from capabilities: Knit's own commands first (`/clear` always, `/model` if the agent can choose a model, `/usage` for every known agent), then the agent's own list from `meta.commands` when it declares `commandList` (a Knit command hides an agent command of the same name). Arrow keys move, Enter or Tab picks, Escape closes. A Knit command runs at once (`/clear` opens the new-session form, `/model` focuses the model field, `/usage` opens the panel and sends `/usage` as a turn to an agent that reports plan usage, or says it is not reported); an agent command is completed into the field and sent to the agent as the prompt.

**Profile (D5, level 1).** Next to the composer: only the fields the agent's `profileFields` lists, and the model as a picker (from `GET /api/agents/:agent/models`) only when it declares `chooseModel`, free text if the list is empty. The values travel as the turn's profile and become CLI flags. They are remembered per agent while the page is open and never written anywhere else.

**Sending.** A session that is running, or a request in flight, disables Send and says why. The server answers `202` only when the child has recorded its turn, so the page then reads again at once. A refusal (`409`, `400`, `502`) is shown as an alert and keeps the text. An agent that cannot resume gets no composer on a session that already has a conversation.

**Plan handoff (T13, S15, D7).** `skills/knit-plan` (`.claude/skills/knit-plan/SKILL.md`) teaches Claude to write a plan in the [plan format](plan-format.md) to `docs/plans/<slug>.md` of the repository the session runs in and to run `knit validate` until it passes. The directory is the constant `PLAN_DIR` in `src/core/ports/plan-drafts.ts`. The session view lists the drafts it finds there (`GET /api/sessions/:id/plans`) as a card above the composer: name, validation result (every issue when invalid), the tasks and their branches. **Launch** is an explicit button that posts `{ planPath }` to the run-control start route (`POST /api/runs`); a Claude turn never starts a run, and an invalid plan cannot be launched. The run is linked to its session by its plan file: the runs list of a draft is every run whose recorded `planPath` is that file, and each links to the run view. The link is derived, not stored, so the server still writes nothing and the schema is unchanged; two sessions in the same directory share their drafts.

**Two timeline components.** The workspace renders its turns with `Timeline` and `TimelineEntry` (`sessions/timeline.ts`). The run's task panels render their attempts with `TimelineList` (`web/src/detail/describe.ts`). Both read the same normalized entry kinds, but they are separate components; merging them is open (see Known limits).

## Single view

The app has one screen and no page navigation (the Runs, Workspace and Configuration tabs and their `#/runs`, `#/workspace`, `#/config` page routes are gone). It opens on three blocks, Claude on the left, the orchestrator in the middle and Cursor on the right, each styled from the agent identity module (the monogram stays when a logo file is missing). Knit is the name of the product; its middle block is labelled Orchestrator.

**Which run it shows.** `#/runs/<id>` or `?run=<id>` picks a run; without either, the most recent run. `?fixture=<name>` and `?demo=1` show a built-in sample instead (used for screenshots). The hash `#/runs/<id>` remains only as the run selection the panels make (`web/src/route.ts`); it opens no page. Claude's open session is not in the URL: it is panel state, defaulting to the most recent session.

**Blocks.** Each block is a compact group whose open button stretches over the card, drawn in its identity's skin (`skin` in `web/src/identity/agents.ts`; components never branch on the agent's name). Claude takes claude.ai's look (ivory card, serif title, clay orange `✻`) with a Claude Code terminal inside: the latest actions as `⏺` and `⎿` lines, the spinner cycling Claude Code's glyphs (`·✢✳✶✻✽`) with "Cogitating… (esc to interrupt)" while it works, an input-like "> Open Claude" row, and Claude Code's mascot drawn with block characters above the card. The orchestrator is a delivery pipeline in Knit's teal: a horizontal track of its five stages, Plan, Queue, Build, Checks and Deliver (`deriveStages`, pure and unit-tested), with the stage in hand spelled out ("Build · T3 · attempt 1") and its latest lines. Cursor is its dark agent panel in both themes: the "∞ Agent" mode pill, the active task, edits as file rows (name, folder, a green "Edited" tag) and an agent input row. Brand surfaces are tokens (`--claude-*`, `--cursor-*`, `--font-serif`). Blocks share the height of the row, so the return wire meets them. Claude reads from the latest session, the orchestrator from the run's board, Cursor from the board's active task and attempt (`deriveBlocks`).

**Details.** A "Details" toggle on each block (separate from opening it) drops a sheet below the card, in the block's own surface, with facts from `deriveDetails` (pure, unit-tested) that say "No session" or "None" instead of guessing: Claude's model (reported by the agent, else the last turn's), context (input tokens of the last finished turn), turns, plan, plan usage meters and the subagents still running (Task or Agent tool calls not yet completed, by description); the orchestrator's run status, delivered tasks with a meter, attempts and elapsed time; Cursor's task, attempt, branch, tokens and agent time. A button in the sheet opens the block to change the model or session, or to manage the run. Escape folds the sheet and returns focus to the toggle; under 820 px the sheet flows in place instead of overlaying.

**Pipeline.** Three hops join the blocks: Claude to orchestrator (stages plan drafted, plan sent, tasks queued), Orchestrator to Cursor (task queued, prompt sent, agent working) and Cursor back to orchestrator (result back, checks running, verdict), the last drawn as a U under the row. Each hop is a curved SVG wire with a port at each end. On an `active` hop a glowing stream and particles flow along the wire; `done` hops are solid green, `failed` ones red, `idle` ones dotted grey. Under the wire, a compact stepper shows one numbered dot per stage (finished ones checked, the current one highlighted, every name available to screen readers) with the current stage spelled out, then up to three one-line log entries (full text in the `title`) with a short enter animation. `deriveHops` (pure, unit-tested) derives stage, status and lines; `hopProgress` and `clipLine` are the other pure helpers. Containers under 820 px (small windows, or a side panel open) stack the pipeline top to bottom with vertical wires. Every animation stops under `prefers-reduced-motion`; the stage highlight stays. Colors, spacing and motion come from the design tokens, in light and dark.

**Side panel.** Clicking a block, or pressing Enter on it, opens a non-modal dialog next to the pipeline, which stays visible and animated. Focus moves into the panel, Escape or the Close button closes it, and focus returns to the block. The header button Configuration opens the `config` slot the same way. On windows under 900 px the panel is a sheet over the right side.

**Panel contract** (`web/src/single/panels/registry.ts`). `PANELS` maps `PanelId` (`"claude" | "knit" | "cursor" | "config"`) to `{ title, Component }`; every component receives `PanelProps` (`board`, `runId`, `live`, `renderDetail`, `selectRun`). Each panel lives in `web/src/single/panels/<name>/<Name>Panel.tsx` and can be replaced without touching the shell or the registry. Today the bodies wrap the existing containers: Claude = `WorkspaceView`, Knit = run control plus `RunsView`, Cursor = the active task's detail plus `FilesView`, config = `ConfigView`.

### Claude panel

`single/panels/claude/ClaudePanel.tsx` (S3): a compact side panel in the spirit of an IDE extension panel, built from the workspace pieces above.

- **Header** (`ClaudePanelHeader`): a session picker (native select, most recent first), a New session button, and chips for the agent, the session status, the model and profile values chosen in the composer, and the working directory.
- **Body** (scrolls): the compact usage meter (`UsagePanel compact`: session tokens and plan windows when the agent declares `planUsage`), the timeline, the detected plan drafts, and the "Continue in terminal" command when the server sent one.
- **Send plan to the orchestrator:** each draft plan has a prominent "Send plan to the orchestrator" button that posts the existing launch (`POST /api/runs`). It never fires by itself; for an invalid plan it stays disabled and says "Fix N issues first." A Claude turn never starts a run.
- **Composer** pinned at the bottom with the command palette. `/usage` sends a turn, as before (S7).
- Everything renders from the agent's capabilities and output is text only.

## HTTP API

Built in tasks T3 (read routes) and T8 (run control, `src/server/routes/control.ts`). Every route sits behind the same [security guard](#security).

| Route | Returns |
| --- | --- |
| `GET /api/runs` | `{ runs }`: `RunListItem[]`, newest first, with status, task counts and token totals |
| `GET /api/runs/:id` | the `RunSnapshot` (`run`, `tasks`, `attempts`, `events`, `lastEventId`, `lastAgentEventId`) plus `board`, the `BoardModel` built by `core/board`. The plan text is `run.planText` |
| `GET /api/runs/:id/tasks/:task/attempts/:n/timeline` | `{ runId, taskId, attempt, events }`: the agent timeline of one attempt (lazy, for expanded blocks). An attempt without entries is an empty list |
| `GET /api/runs/:id/roots` | `{ roots }`: what the explorer may show, `repo` (the run's repository) and one entry per task that has a worktree (id is the task id) |
| `GET /api/runs/:id/files?root=<id>&path=<dir>` | `{ root, path, entries }`: one directory level, directories first; `path` is relative and empty for the root |
| `GET /api/runs/:id/file?root=<id>&path=<file>` | `{ root, kind, path, size, ... }`: `kind` is `text` (with `text`), `binary` or `too-large` (with `limit`, 512 KiB); bytes of binary or oversized files are never sent |
| `GET /api/runs/:id/tasks/:task/activity?attempt=<n>` | `{ runId, taskId, attempt, touched }`: the relative paths the attempt's file tool calls touched, each once. Without `attempt`: `{ runId, taskId, touched, worktree }` for the whole task, where `worktree` is `{ paths, moreFiles }` (at most 200 paths) from the worktree's git status, or `null` when the worktree is gone or not a git worktree. 400 on a malformed `attempt`, 404 for an unknown task |
| `GET /api/runs/:id/tasks/:task/diff` | `{ runId, taskId, startSha, commitSha?, files, moreFiles }`: what the task changed, read from its worktree between `startSha` and `commitSha` (to the worktree content while the task has no commit). Each file has `path`, `status` (`added`, `modified`, `deleted`), `binary`, `additions`, `deletions` and the `patch` hunks; a patch over 100,000 characters is left out with `truncated: true`, and at most 200 files are listed (`moreFiles`). 404 when the task has not started or its worktree is gone, 503 on a server without the diff port |
| `GET /api/runs/:id/stream` | Server-Sent Events, see below |
| `GET /*` | the built app from `dist/web` (or the directory the server was started with) |

Errors are JSON, `{ "error": "<message>" }`, with the right status: `404` for an unknown run, task or API route, `400` for a malformed request (a non-numeric attempt, a bad `Last-Event-ID`, a malformed percent escape, an invalid body), `401` and `403` from the guard, `409` for a command the run's state does not allow, `413` and `415` for a body that is too large or not JSON, `405` (with `Allow`) for a known path with another method, `500` when a handler fails. API responses carry `Cache-Control: no-store`.

### Live stream

`GET /api/runs/:id/stream` polls the `RunReader` every 500 ms and pushes only the rows it has not sent yet:

| SSE `event` | Data |
| --- | --- |
| `event` | a lifecycle event (the `events` table row, with its `id`) |
| `agent_event` | an agent timeline entry (the `agent_events` row, with its `id`) |
| `done` | `{ "status": "passed" \| "failed" }`, sent once and followed by the end of the stream, when the run is no longer running and every row was delivered |

- **Ids.** Lifecycle events and agent events have separate id sequences, so one SSE id carries both cursors: `<lastEventId>.<lastAgentEventId>`. The id of each message is the pair of cursors right after that message. A poll sends its lifecycle rows first, then its agent rows. This is what makes resuming exact (the task's wording is "row `id` as the SSE `id`"; with two tables a single number cannot be unambiguous).
- **Resuming.** A reconnecting browser sends `Last-Event-ID` and receives exactly the rows after that pair: no gap and no duplicate. The first connection of a page can pass `?after=<lastEventId>.<lastAgentEventId>` (the two values of the snapshot it just fetched); the header wins when both are present. With neither, the stream starts from the beginning of the run, in slices of 500 rows per poll. A malformed value is a `400`.
- **Heartbeat.** A `: ping` comment every 15 s keeps idle connections open.
- **End.** The status of the run is checked about every 2 s while the stream is idle, and always before a poll, so the rows written before the run finished are delivered before `done`. The client must close its `EventSource` on `done`, or it reconnects and receives another `done`.
- **Cost.** Polling stops as soon as the client disconnects. A failed read (the database being migrated by another process) is retried on the next poll.
- **Not in the stream.** `task` and `attempt` messages (rows without an increasing id) are not sent: the page derives them from the lifecycle events, or refetches `GET /api/runs/:id`.

### Run control

Every one is a `POST` with `Content-Type: application/json` (`415` otherwise) and a body of at most 64 KB (`413`); an empty body counts as `{}`, anything that is not a JSON object is a `400`. The routes never write the database: each one starts a Knit command through the **spawner** that the composition root injects (`ServerOptions.control`: the data directory and a function that starts a child). Without it (a source checkout with no build, so no `dist/cli/index.js` to start) they answer `503` and the rest of the server is unaffected.

| Route | Body | Does | Answers |
| --- | --- | --- | --- |
| `POST /api/runs` | `{ planPath, push?, pr?, maxAttempts? }` | `knit run <planPath> [--push] [--pr] [--max-attempts <n>]` | `202 { runId, pid, logPath }` |
| `POST /api/runs/:id/abort` | none | `knit abort <id>` | `202 { runId, logPath }` |
| `POST /api/runs/:id/resume` | none | `knit resume <id>` | `202 { runId, pid, logPath }` |
| `POST /api/runs/:id/tasks/:task/retry` | none | `knit resume <id>`, which re-runs the failed task and then the ones that were skipped after it | `202 { runId, pid, logPath }` |

Every child gets `--data-dir <the server's data directory>`, runs in its own process group (`detached`, `unref`), has stdin closed and appends stdout and stderr to `<data dir>/logs/_ui/<command>-<timestamp>-<random>.log` (`logPath` in the answer). Its environment is the server's, minus `KNIT_UI_TOKEN` and `KNIT_TOKEN`: the launch token is never put in an environment variable or an argument, and a child never receives it.

**Start.** `planPath` must be an absolute path to a readable regular `.md` file of at most 1 MB that the core plan parser accepts; otherwise `400`, and for a plan that does not parse the body is `{ error, issues }` with **every** issue the parser found. Unknown fields, a non-boolean `push` or `pr`, and a `maxAttempts` that is not a whole number from 1 to 20 are `400`s. The child runs in the plan's directory (so a plan without `Repo:` resolves it from there). The run id is generated by the child, so the server waits (up to 10 s) until the reader shows a **new** run that is `running` with `pid` equal to the child's pid. If the child exits first the server looks once more (a trivial run can finish between two polls) and otherwise answers `502 { error, logPath }`; if nothing shows up in time it answers `504 { error, logPath }` and leaves the child alone. `502` is also the answer when the process cannot be started.

**Abort.** `404` for an unknown run, `409` if it is not `running`. Otherwise `202` as soon as `knit abort` is started: the abort itself can take the whole grace period, so the page follows it through the stream (the run turns `failed` and a `run.aborted` event appears). What `knit abort` does, and what it refuses to do, is in [run-lifecycle.md](run-lifecycle.md#abort).

**Resume and retry.** `404` for an unknown run (or task), `409` if the run is `running`; retry also needs the task to be `failed` (`409` otherwise). Both start `knit resume <id>` and wait, like start, until the run is `running` again with the child's pid before answering `202`; `502` and `504` as above. While one request waits, a second one for the same run is a `409` (two resumes of one run would be two writers).

**Stale pids.** `runs.pid` is set while a run is `running` and cleared when it finishes or is aborted. A run killed with `SIGKILL`, or whose machine rebooted, keeps its stale pid and stays `running`. The interface shows it as running until someone runs `abort`, which notices that the process is gone, marks the run `failed` (`run.aborted`, reason `stale-pid`) and clears the pid; `resume` then works. Because pids are reused, `knit abort` signals a process only when its command line is a Knit `run`, or a `resume` of that same run id, and no other running run records the same pid; anything else is refused with nothing signalled.

### Configuration editor (T16)

Edits the files the CLIs read, so a terminal `claude` or `agent` session sees the same configuration (D5). Routes in `src/server/routes/config.ts`, port `ConfigFiles`, adapter `FileConfigFiles` (`src/adapters/system/config-files.ts`).

| Route | Does |
| --- | --- |
| `GET /api/config/files` | `{ files }`: every allowed file (`id`, `agent`, `scope`, `label`, `displayPath`, `isRule`, `exists`) |
| `GET /api/config/file?id=<id>` | `{ id, exists, content, hash, json }`; an absent file is empty with hash `"absent"` |
| `PUT /api/config/file` | body `{ id, content, expectedHash }`; copies the current version to the backup folder, writes the new one, answers `{ hash, backupPath? }` |

**Allow-list.** Files are named by opaque ids (`<agent>:<scope>:<slot>`), never by a path. Project scope is the directory `knit ui` was started in; global scope is the home directory.

| Agent | Project | Global |
| --- | --- | --- |
| Claude | `CLAUDE.md`, `.claude/settings.json`, `.claude/rules/**/*.md` | `~/.claude/CLAUDE.md`, `~/.claude/settings.json`, `~/.claude/rules/**/*.md` |
| Cursor | `.cursor/rules/**/*.mdc` and `.md`, `.cursor/mcp.json` | `~/.cursor/cli-config.json`, `~/.cursor/mcp.json` |

Rules files may be created (`expectedHash: "absent"`); names are checked per segment (letters, digits, `.`, `_`, `-`, no leading dot, at most three levels, known extension).

**Guards** (this edits permission and settings files):

- A symlink is followed only when its real target stays inside the scope's root; a link out of it, or a broken one, is `403`. Traversal, absolute paths and separators in an id are `403`.
- `expectedHash` must be the hash the editor read, otherwise `409`: a file changed elsewhere is never overwritten silently. The web app shows a diff of the edit against the version it read before it enables Save.
- JSON files (`settings.json`, `mcp.json`, `cli-config.json`) must stay a valid JSON object (`400`); content is UTF-8 text without NUL, at most 256 KB (`413`). Bodies are limited to 2 MB.
- The replaced version is copied first to `<data-dir>/config-backups/<id>/<timestamp>-<hash>.bak` (folder `0700`, files `0600`); if the backup fails nothing is written. The new version goes to a temporary file that is renamed into place, keeping the file's mode.
- A save looks again, right before the file is replaced, at the folder and at the file's hash: a file written by another tool in between, or a folder swapped for a link, is reported as a conflict and nothing is replaced. The window is short but not zero: a same-user process that swaps something between that last look and the rename is still not defended against. The files are shown as they are, so secrets inside `cli-config.json` are visible to whoever holds the launch token.

**In the app** (the Configuration button of the single view opens it as a side panel, `web/src/single/panels/config/`): files are grouped by agent and scope with each agent's identity color. The editor is CodeMirror 6 (Markdown and JSON highlighting, line numbers), loaded lazily the first time the panel opens. Undo and redo work by edit groups (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y; Cmd on macOS). One editor instance stays mounted from editing through review, so the history survives "Review changes" and "Keep editing" (it is read-only while the diff shows below it); reading another file, or reloading after a conflict, starts a new history. Keyboard: Tab is not bound, so it leaves the editor; Escape leaves the editor when there are unsaved edits (a second Escape closes the panel) and closes the panel when there are none. The editing area is a labelled textbox ("Contents of <file>"). "Review changes" (enabled only when the text changed and, for JSON files, still parses) shows a line diff (`web/src/config/diff.ts`), and only that step offers "Save". A `409` offers "Reload the file".
### Sessions

Built in task T12 (`src/server/routes/sessions.ts`). Reads go through the `SessionReader` port (a read-only SQLite connection that never writes or migrates; a database from before schema 5 reads as having no sessions). A turn starts by spawning `knit chat` through the same spawner as run control, so the server never writes the database. The session dependencies (`SessionsDeps`: the reader and one `AgentInfo` per agent) travel inside `ControlDeps.sessions`: without control (no build) the read routes answer empty lists and the POSTs `503`.

`AgentInfo` is built in `cli/commands/ui.ts`, the one place that knows the adapters: id, label, the adapter's declared `capabilities`, the `profileFields` it takes (`model`, `effort`, `permissionMode`), `listModels` and the terminal command that resumes its own session. The page renders from that, never from an agent's name.

| Route | Returns / does |
| --- | --- |
| `GET /api/agents` | `{ agents: [{ id, label, capabilities, profileFields }] }` |
| `GET /api/agents/:agent/models` | `{ models }` from `listModels`; empty for an agent that cannot choose its model or cannot be asked; `404` for an unknown agent |
| `GET /api/sessions` | `{ sessions: [{ session, turnCount, inputTokens, outputTokens }] }`, most recently active first |
| `GET /api/sessions/:id` | `{ session, turns, meta, lastEventId, continueCommand? }`. `meta` is the newest `commands` and `planUsage` any turn reported (plus `model`); `continueCommand` is `cd '<cwd>' && <agent> --resume <agent session id>`, present once the agent reported its session id and only if it can resume |
| `GET /api/sessions/:id/events?after=<id>` | `{ sessionId, events, lastEventId }`: timeline entries with `id > after` (at most 2000), so a poller resumes with no gap or duplicate |
| `POST /api/sessions` | `{ agent, cwd, prompt, profile? }` runs `knit chat --agent <a> --cwd <cwd> [profile flags] --data-dir <dir> -- <prompt>` and answers `202 { sessionId, logPath }` once a new session shows up |
| `POST /api/sessions/:id/turns` | `{ prompt, profile? }` runs `knit chat --session <id> ...` and answers `202 { sessionId, logPath }` once the turn is recorded; `409` while a turn is running or when the agent cannot resume |
| `GET /api/sessions/:id/plans` | `{ dir, plans: [{ path, file, modifiedAt, name, valid, issues, tasks, runs }] }`: the drafts in `docs/plans/` of the session's directory (newest first, at most 20), each validated with the plan parser, with `runs: [{ id, status, startedAt }]` started from that file. Read-only; `404` for an unknown session, `503` without plan detection |

`cwd` must be an absolute existing directory; `prompt` at most 32,000 characters; a profile field must be one the agent takes and match `[A-Za-z0-9][A-Za-z0-9._:/[\]-]*` (never starts with a dash). The prompt goes after `--`, so a prompt that starts with a dash is still a prompt. `502` and `504` as for run control when the child dies or is too slow to record its turn.

### Adding routes

A route module lives in `src/server/routes/<name>.ts` and exports a function from the server's dependencies (`ServerDeps`: the reader, timings and, when present, `control`) to a list of `{ method, pattern, handler }` (patterns use `:name` segments, decoded for the handler; a handler throws `HttpError(status, message)` to answer an error). It is registered with one line in `src/server/routes/index.ts`. The guard runs before routing, so a new route, whatever its method, cannot skip it.

## Visual model

One canvas per run, read left to right as a circuit:

```
 ┌──────────┐   plan + tasks    ┌───────────────────────┐   prompt    ┌──────────┐
 │  Claude  │ ═════════════════►│  Knit                 │────────────►│  Cursor  │
 │ planner  │                   │  queue ▢▢▢  ▶ T2      │◄────────────│ builder  │
 └──────────┘                   │  checks · scope · git │   result    └──────────┘
                                └──────────┬────────────┘
                                           ▼
                                     PR #12 → PR #13 (stack)
```

- **Three identity blocks.** Claude, Knit and Cursor each keep their own icon, accent color and label. Surfaces stay neutral; color belongs to identity and status, nothing else.
- **Claude block (the brain).** Shows what Claude handed over: the plan, its author and its tasks. Its outgoing wires carry one strand per task. Its detail panel shows the plan text and each task's specs. Claude's live timeline is in the [Workspace](#workspace-built), not on the canvas: the canvas shows no timeline for Claude. Headless Claude sends its reasoning blocks empty, and the workspace marks reasoning as not shared.
- **Wires.** SVG paths between blocks. When something travels (a task leaves the queue, a prompt is sent, a result comes back) a pulse runs along the wire. Animations respect `prefers-reduced-motion`.
- **Queue.** Pending tasks wait as stacked cards on Knit's input side, in execution order. A `Depends` link shows as a small connector between cards. The running task sits in Knit's center; finished tasks move to the delivery lane as PR chips.
- **Cursor block.** While an attempt runs, it shows a single live line: the current thought, message or tool call.
- **Expandable blocks.** Every block opens for detail, from summary to raw:
  - task → attempts (duration, tokens, verdict) → agent timeline (thinking, messages, tool calls with arguments and results)
  - Knit → setup, checks with their output tail, scope and git verdicts, retries with the feedback sent
  - Claude → the plan text and each task's specs
- **Runs list.** A quiet sidebar or start page with past runs and their status. The live run opens by default.
- **Light and dark themes**, from design tokens.

## Security

Built in task T3 (`src/server/security.ts`, applied to every request before routing). The server can launch agents that have no sandbox, so any page able to call it could make them run commands on this machine.

- **Loopback only.** It listens on `127.0.0.1` and nothing else; the port is configurable with `--port`, the host is not.
- **Launch token.** Each launch generates a token (32 random bytes, hex). Every request must present it, and the comparison is constant time (both sides are hashed, then compared with `timingSafeEqual`). It is accepted from:
  1. the `Authorization: Bearer <token>` header;
  2. the `knit_token` cookie.

  The first page load carries `?token=<token>`, the URL `knit ui` prints. On a `GET`, a valid `?token=` is answered with `302` to the same URL without the token, plus `Set-Cookie: knit_token=<token>; HttpOnly; SameSite=Strict; Path=/`. A wrong `?token=` is a `401`. The cookie is what `fetch` and `EventSource` use afterwards (`EventSource` cannot set headers). A token in the query of any other request is ignored, so the token only ever travels in a URL once.
- **Host check (DNS rebinding).** The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`, otherwise `403`, before anything else is read.
- **Origin check.** `POST`, `PUT`, `PATCH` and `DELETE` also need an `Origin` header equal to `http://<the Host of the request>`: a request from another website, or without an `Origin`, is a `403`. Order of checks: host (`403`), token (`401`), origin (`403`).
- **Responses.** `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, a restrictive `Content-Security-Policy` (`default-src 'self'`, scripts from the same origin only, `frame-ancestors 'none'`, `object-src 'none'`; inline styles are allowed because React sets `style` attributes) and `Cache-Control: no-store` on API responses. No CORS headers are ever sent, so browsers keep other origins from reading responses.
- **Static files.** The path is decoded and resolved inside the served directory; anything that leaves it (`..%2f`, an encoded NUL or backslash, a symlink pointing out) is a `400` or `403`, never a file.
- **The token is never logged.** The only place it is written is the line that prints the launch URL.
- The database connection is read-only; the server changes state only by starting Knit or agent processes.
- **Run control is the dangerous part.** It starts agents that have no sandbox, so it relies on every check above: a cross-site page cannot get past the `Origin` check, and one that tried a simple form post is stopped by the JSON-only content type (`415`) before any command is started. The routes accept no executable, no agent command and no free-form argument: the command line is built by the server from a validated absolute plan path, two booleans and a bounded integer, or from a run id that must already exist in the database. Arguments are passed as an array, never through a shell. The server never signals a process itself; `knit abort` does, and only after verifying the target.
- Agent output is untrusted. Render it as text; any Markdown rendering is sanitized. Never inject agent strings as HTML.

## Known limits and follow-ups

- **No durable run-to-session link.** A run belongs to a session when its `planPath` is that session's draft file; the link is derived, never stored.
- **Check output not stored.** Knit keeps only the failed check's command, so the output shown is the setup command's (see [Detail panels](#detail-panels-built)).
- **Session-level file activity not done.** File activity is shown for task attempts only, not in the workspace.
- **Configuration editor.** The last check before the rename narrows the race window with another writer but cannot close it (same-user local race). `.claude/settings.local.json` is not in the allow-list.
- **Polling for sessions.** The workspace polls (about every 0.8 s while a turn runs, 4 s otherwise) instead of using SSE.
- **Not on the canvas.** Claude's live timeline; the run's and the workspace's timeline components are separate.
- **Follow-ups from the interface.** `knit followup` has no HTTP route; it runs from the CLI only.
- **Interactive resume unverified.** `claude --resume` of a `-p` session has not been tried by hand (see [Agents and sessions](#agents-and-sessions)).

## Brand assets

Blocks use the official Claude and Cursor logos and brand styles. The logo files are trademarks of their owners and are not committed: they live in `web/public/brand/` (git-ignored), filled by the user from the official press kits. When a file is missing, the block falls back to a monogram. Names, brand colors and styles live in one identity module, never in components. Knit gets its own original mark. The expected file names are listed under [Logo files](#logo-files).

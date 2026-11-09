# Web interface

> **Partly built.** This is the agreed design for `knit ui`. Built so far: the read side (T2) and the server with `knit ui` (T3: read routes, live stream, static files, security). Not built yet: the web app itself, run control and everything from phase B on. Progress and open decisions are tracked in [../odd/tasks/web-interface.md](../odd/tasks/web-interface.md). Sections say "built" when they are.

A local web app that joins Claude and Cursor into one workflow and is the single place to review everything.

## Workflow

```
 1. Plan with Claude          2. Orchestrate with Knit         3. Implement with Cursor
 conversation, any topic  ─►  plan validated, user launches ─► one task at a time, verified
 (most turns end here)        queue, checks, retries, PRs       in its own worktree
```

- **Planning is a conversation.** A Claude session runs in the target repository with the user's own Claude configuration (CLAUDE.md, rules, skills, MCP servers), so it behaves like a terminal session. Most turns never leave this stage.
- **The handoff is explicit.** Only development with a finished plan moves on. Claude writes a plan in the [plan format](plan-format.md) and validates it; the interface shows it as a draft and the user launches it. A Claude turn never starts a run by itself.
- **Tokens go where they pay off.** Claude reasons and plans; Cursor implements from self-contained prompts with no memory MCP; Knit's checks are deterministic and never call a model. Token usage is shown per agent for every turn, attempt, session and run.

It is built in five phases:

| Phase | Adds |
| --- | --- |
| A | live view of runs, run control (start a plan, abort, resume, retry a task) and each task's diff |
| B | workspace: persistent sessions with live timeline, per-turn profile (model, effort, permissions), command palette, usage panel, live file activity, and the plan handoff |
| C | Cursor sessions on the same model: follow-ups on a task's chat inside its worktree, verified again by Knit |
| D | configuration editor for the files both CLIs read, with a diff before saving |
| E | file explorer (later) |

## Agents and sessions

One model serves every agent: a **session** is a conversation with one agent, a **turn** is one prompt and its answer, and every turn produces timeline events. Each agent adapter declares its **capabilities**, and the interface renders from them, never from the agent's name. Adding an agent means writing its adapter and its identity.

| Capability | Claude | Cursor |
| --- | --- | --- |
| resume a session | yes (`--resume`; verified, the session id stays the same) | yes (`--resume`); not wired in the adapter yet |
| choose the model | yes (`--model`) | yes (`--model`, `agent models`) |
| command list | yes (`system/init.slash_commands` minus `terminal_slash_commands`) | to verify |
| visible reasoning | no (blocks arrive empty, with only a signature) | yes |
| plan usage | yes (`rate_limit_event`: 5-hour and 7-day windows, utilization 0 to 1) | to verify |

The port declares these as `AgentCapabilities` on each runner (`src/core/ports/agent-runner.ts`); `capabilitiesOf(runner)` returns all-false for a runner that declares none. The Claude adapter (`src/adapters/agents/claude/`) declares resume, model, command list and plan usage as supported and reasoning as not visible. The Cursor adapter declares what it supports today: model choice and visible reasoning. The per-turn profile maps to flags one to one: `--model`, `--effort`, `--permission-mode`.

**What was verified against the real Claude CLI (2.1.319, headless `-p`, subscription auth):**

- **Slash commands through `-p`.** `/usage` sent as the prompt does not call the model: the stream holds one synthetic assistant message (model `<synthetic>`) with the command's text, and a `result` with `num_turns: 0` and zero tokens; there is no `rate_limit_event`. `/context` was not tried. So a slash command can be sent as a prompt and its answer is plain text, but Knit cannot read structured numbers from it: the `/usage` panel is built from `rate_limit_event` and `result.usage` instead (D9). Commands that only make sense in a terminal are listed in `terminal_slash_commands` and are left out of the palette.
- **Resume.** `claude -p --resume <id> "<prompt>"` continues the same conversation (the agent recalled what the first turn asked) and the session id does not change: every event and the `result` carry the id given.
- **Interactive resume of a `-p` session** (`claude --resume <id>` in a terminal) cannot be tested headless, so it is not verified. D10 relies on it, which stays an assumption until someone tries it by hand.
- **Reasoning.** Headless Claude emits `thinking` blocks with an empty text; the timeline marks them as "not shared by the agent". The two short calls made to see one (a haiku-class model, with and without `--effort high`) produced no thinking block at all, so the empty-block shape comes from the design brief, not from a recorded stream.
- **Configuration.** By default the adapter does not pass `--bare` or `--strict-mcp-config`, so the session uses the user's own CLAUDE.md, rules, skills, hooks and MCP servers (D6). Hooks run even with `--strict-mcp-config`: it only ignores configured MCP servers. A prompt is passed after `--` so one that starts with a dash is not read as a flag.
- **Tokens.** `inputTokens` is `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` of the final `result`, and its usage is cumulative over the requests of the turn, so a turn that calls tools counts the cached prompt once per request. The timeline entry keeps the cache parts apart.

- **Command palette.** Built from the agent's own list, so it follows every CLI update. Session commands are handled by Knit: `/clear` starts a new session, switching chats uses the session list, `/model` sets the turn profile, `/usage` opens the usage panel. Any other command is sent to the agent as the prompt.
- **Continue in a terminal.** Every session shows the command that continues it (`claude --resume <id>`, `agent --resume <chatId>`). Knit does not try to match each agent's own interface; whatever it lacks stays one copy away.

## Files

- **Phase A:** each task's diff, from its start commit to its last commit.
- **Phases B and C:** the files an agent touches while a turn runs, from tool-call paths and the worktree's `git status`.
- **Phase E:** a file explorer for the repository and the task worktrees.

## Process model

```
            ┌──────── spawns (detached) ────────┐
            │                                   ▼
 browser ◄──┤ knit ui ──reads (readonly)──► ~/.knit/knit.db (WAL) ◄──writes── knit run / knit resume
  JSON+SSE  │ 127.0.0.1                         ▲
  POST cmds └─── spawns (phases B, C) ──► knit chat → claude -p / agent -p --resume ──writes──┘
```

- `knit ui` is a separate, long-lived process. It **reads** the database through a read-only connection; only the processes it starts write. WAL lets it read while they write.
- Runs stay one-shot processes. The server starts `knit run` or `knit resume` as detached children and aborts them by signalling their process group (pid recorded in `runs`), so a run survives the interface being closed.
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
    ports/run-reader.ts     read-side port: runs, tasks, attempts, events, agent events after an id
    board/                  pure: records → board view model (nodes, wires, queue, task blocks)
  adapters/
    storage/sqlite/         RunReader implementation (readonly connection)
  server/                   driving adapter: HTTP routes, SSE stream, static files, security guard (built)
  cli/commands/ui.ts        wires the SQLite reader into the server; the only place adapters are chosen
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

It prints one line, `http://127.0.0.1:<port>/?token=<token>`, and keeps running until `SIGINT` or `SIGTERM`, then closes its connections and exits with 0. It never opens a browser: open the address yourself. The host is not configurable. If `knit.db` does not exist yet, the server still starts (the runs list is empty) and opens the database, read-only, as soon as `knit run` creates it.

## HTTP API

Built in task T3 (`src/server/`). Every route is a `GET` for now; the `POST` routes of the next tasks sit behind the same [security guard](#security).

| Route | Returns |
| --- | --- |
| `GET /api/runs` | `{ runs }`: `RunListItem[]`, newest first, with status, task counts and token totals |
| `GET /api/runs/:id` | the `RunSnapshot` (`run`, `tasks`, `attempts`, `events`, `lastEventId`, `lastAgentEventId`) plus `board`, the `BoardModel` built by `core/board`. The plan text is `run.planText` |
| `GET /api/runs/:id/tasks/:task/attempts/:n/timeline` | `{ runId, taskId, attempt, events }`: the agent timeline of one attempt (lazy, for expanded blocks). An attempt without entries is an empty list |
| `GET /api/runs/:id/stream` | Server-Sent Events, see below |
| `GET /*` | the built app from `dist/web` (or the directory the server was started with) |

Errors are JSON, `{ "error": "<message>" }`, with the right status: `404` for an unknown run, task or API route, `400` for a malformed request (a non-numeric attempt, a bad `Last-Event-ID`, a malformed percent escape), `401` and `403` from the guard, `405` (with `Allow`) for a known path with another method, `500` when a handler fails. API responses carry `Cache-Control: no-store`.

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

Commands (phase A; phase B adds sessions, turns and plan launch; phase D adds configuration). Not built yet:

| Route | Does |
| --- | --- |
| `POST /api/runs` | start a plan (`knit run <plan>`) |
| `POST /api/runs/:id/abort` | signal the run's process group |
| `POST /api/runs/:id/resume` | `knit resume <id>` |
| `POST /api/runs/:id/tasks/:task/retry` | resume from that failed task |

### Adding routes

A route module lives in `src/server/routes/<name>.ts` and exports a function from the server's dependencies to a list of `{ method, pattern, handler }` (patterns use `:name` segments, decoded for the handler; a handler throws `HttpError(status, message)` to answer an error). It is registered with one line in `src/server/routes/index.ts`. The guard runs before routing, so a new route, whatever its method, cannot skip it.

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
- **Claude block (the brain).** Shows what Claude handed over: the plan, its author and its tasks. Its outgoing wires carry one strand per task. From phase B it also shows Claude's live timeline with the same components as Cursor's. Headless Claude sends its reasoning blocks empty, so the block shows messages and tool calls, and marks reasoning as not shared.
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
- Agent output is untrusted. Render it as text; any Markdown rendering is sanitized. Never inject agent strings as HTML.

## Brand assets

Blocks use the official Claude and Cursor logos and brand styles. The logo files are trademarks of their owners and are not committed: they live in `web/public/brand/` (git-ignored), filled by the user from the official press kits. When a file is missing, the block falls back to a monogram. Names, brand colors and styles live in one identity module, never in components. Knit gets its own original mark.

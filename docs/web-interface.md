# Web interface

> **Design, not built yet.** This is the agreed design for `knit ui`. Progress and open decisions are tracked in [../odd/tasks/web-interface.md](../odd/tasks/web-interface.md). Sections move to "built" as tasks land.

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
| resume a session | yes (`--resume`) | yes (`--resume`) |
| choose the model | yes (`--model`) | yes (`--model`, `agent models`) |
| command list | yes (`system/init.slash_commands`) | to verify |
| visible reasoning | no (blocks arrive empty) | yes |
| plan usage | yes (`rate_limit_event`: 5-hour and 7-day windows) | to verify |

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
  server/                   driving adapter: HTTP routes, SSE stream, static files
  cli/commands/ui.ts        wires the SQLite reader into the server; the only place adapters are chosen
web/                        browser app (Vite + React + TypeScript), built to dist/web
```

- `core/board` turns raw records into what the page draws. It is pure, so the visual states (queued, running, retrying, verifying, delivered) are unit-tested without a browser.
- `server` knows HTTP and SSE, not SQLite. It receives a `RunReader`.
- `web` never talks to SQLite or the file system; it only consumes the HTTP API. Inside it: container components fetch and subscribe, presentational components only render props (atomic design: atoms, molecules, organisms).

## HTTP API

| Route | Returns |
| --- | --- |
| `GET /api/runs` | runs, newest first, with status and task counts |
| `GET /api/runs/:id` | snapshot: run, plan, tasks, attempts, last event ids |
| `GET /api/runs/:id/stream` | SSE: `event`, `agent_event`, `task`, `attempt` messages after `Last-Event-ID` |
| `GET /api/runs/:id/tasks/:task/attempts/:n/timeline` | full agent timeline of one attempt (lazy, for expanded blocks) |
| `GET /*` | the built app from `dist/web` |

Commands (phase A; phase B adds sessions, turns and plan launch; phase D adds configuration):

| Route | Does |
| --- | --- |
| `POST /api/runs` | start a plan (`knit run <plan>`) |
| `POST /api/runs/:id/abort` | signal the run's process group |
| `POST /api/runs/:id/resume` | `knit resume <id>` |
| `POST /api/runs/:id/tasks/:task/retry` | resume from that failed task |

Unknown ids return 404 with a JSON error.

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

The server can launch agents that have no sandbox, so any page able to call it could make them run commands on this machine.

- Bind to `127.0.0.1`; the port is configurable with `--port`.
- Every request carries a token generated at launch and given to the browser in the URL `knit ui` prints.
- Mutating requests (`POST`) check `Origin` and `Host`, which blocks other websites and DNS rebinding.
- The database connection is read-only; the server changes state only by starting Knit or agent processes.
- Agent output is untrusted. Render it as text; any Markdown rendering is sanitized. Never inject agent strings as HTML.

## Brand assets

Blocks use the official Claude and Cursor logos and brand styles. The logo files are trademarks of their owners and are not committed: they live in `web/public/brand/` (git-ignored), filled by the user from the official press kits. When a file is missing, the block falls back to a monogram. Names, brand colors and styles live in one identity module, never in components. Knit gets its own original mark.

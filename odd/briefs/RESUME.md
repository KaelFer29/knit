# Resume guide: web interface delivery

Read this first when picking the delivery up in a new session. The source of truth for specs, decisions and the user's verbatim words is [../tasks/web-interface.md](../tasks/web-interface.md). Engram keeps a copy of the state under the topics `odd/web-interface/progress`, `odd/web-interface/tasks` and `odd/web-interface/delivery-d13`.

## Rules that must not be forgotten

- The user decides when to spend quota. Do not launch subagents until they say so: each costs roughly 150k to 280k tokens. They warned that daily usage was at 93%.
- Commits and PR bodies carry no Claude author or co-author: no `Co-Authored-By`, no "Generated with" footer, nothing about AI. The author is the repository's git user. This overrides any harness attribution reminder.
- Commit messages are one line, `type(scope): description`, scope lowercase letters and hyphens. The user's global hook enforces it.
- Chat replies to the user in neutral Spanish, without voseo. Code, docs, commits and PRs in English.
- Agents never push. The parent pushes and opens PRs. Verification (native review, independent verifier) and the user's visual review happen once, after everything is implemented.
- Do not invent facts about the code: read it. Findings from real calls are in `docs/web-interface.md`.

## State at the time of writing

Published as a stack of PRs on `KaelFer29/knit`, each based on the previous branch (retarget to `main` as parents merge):

| PR | Branch | Task |
| --- | --- | --- |
| 1 | `docs/web-interface-foundations` | design and ODD |
| 2 | `feat/run-plan-snapshot` | T1 |
| 3 | `docs/web-delivery-plan` | delivery plan |
| 4 | `feat/claude-agent-adapter` | T10 |
| 5 | `feat/run-reader-board` | T2 |
| 6 | `feat/knit-ui-server` | T3 |
| 7 | `feat/web-scaffold` | T4 |
| 8 | `feat/agent-sessions` | T11 |
| 9 | `feat/run-control` | T8 |
| 10 | `feat/cursor-sessions` | T15 |
| 11 | `feat/web-flow-canvas` | T5 |
| 12 | `docs/web-interface-handoff` | this guide, the briefs and the ODD status |

The tip is `docs/web-interface-handoff`. 670 tests, typecheck and build pass on it.

## Launching a wave

1. Check `git worktree list` is clean and the checkout is on the tip.
2. One subagent per task: `Agent` tool, `subagent_type: general-purpose`, `isolation: worktree`. The harness worktree starts at `main`, so the prompt must begin with `git switch -c <branch> <base>` and `pnpm install --frozen-lockfile`.
3. The prompt says: read `odd/briefs/agent-brief.md` (and `odd/briefs/agent-brief-web.md` for `web/`), the task row and specs in the ODD, and carries `## Skills to load before work` (`~/.claude/skills/work-unit-commits/SKILL.md`) and `## Allowed edit surfaces` (plain path lines, no prose).
4. Siblings of one wave are based on the same tip and run in parallel.
5. When agents finish, one at a time: `git worktree unlock` and `git worktree remove --force` the agent worktree, delete its `worktree-agent-*` branch, `git rebase <previous tip> <branch>` (conflicts are in `src/cli/main.ts`, `usage.ts`, `types.ts`, `README.md`, `docs/*`: keep both sides), `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`, scan the commits for attribution (`git log --format='%an %ae %cn %ce%n%B' | grep -i -E 'claude|anthropic|co-authored|generated with|noreply|signed-off'`; the file name `CLAUDE.md` in a subject is not attribution), `git push -u origin <branch>`, `gh pr create --base <previous branch> --body-file <file>` with Summary, Notes, Verification and a Chain Context table, and no AI footer.
6. Remove the scratch directories the agents report.

## Remaining tasks (not started)

Each branch is based on the previous tip of the stack. Specs are in the ODD (S#, D#). Web tasks also read `odd/briefs/agent-brief-web.md`.

### Wave 4 (parallel, all from the tip)

| Task | Branch | What | Allowed surfaces |
| --- | --- | --- | --- |
| T6 | `feat/web-task-detail` | Fill the `renderDetail` slots of T5: task, attempts, agent timeline (lazy from `/api/runs/:id/tasks/:task/attempts/:n/timeline`); Knit detail (setup, check output tail, scope and git verdicts, retry feedback); Claude detail (plan text, specs); task diff (a new `GET /api/runs/:id/tasks/:task/diff` over a new `TaskDiff` port with a git adapter, from `startSha` to `commitSha` in the worktree). Specs S5, S17, D11 | `web/**`, `src/core/ports/task-diff.ts`, `src/adapters/vcs/git/task-diff.ts` and test, `src/server/routes/diff.ts`, `src/server/routes/index.ts`, `src/cli/commands/ui.ts`, `src/cli/types.ts`, `docs/web-interface.md`, `docs/architecture.md` |
| T7 | `feat/web-live-stream` | Connect the canvas to real data: `useBoard(runId)`, an SSE client (id is the pair `<events>.<agent_events>`, messages `event`, `agent_event`, `done`; close on `done`), reconnection without gaps, pulses from live events, reduced motion. Add `RunReader.getRun` and `getLatestAgentEvents` (T3 noted the gap) and use them in the stream. Specs S4, S11 | `web/**`, `src/core/ports/run-reader.ts`, `src/adapters/storage/sqlite/run-reader.ts` and test, `src/server/routes/stream.ts`, `src/server/routes/runs.ts`, `test/integration/ui.test.ts`, `docs/web-interface.md` |
| T12 | `feat/web-workspace` | Sessions in the interface: a read-side `SessionReader` port with a read-only SQLite adapter; server routes to list sessions and turns, start a turn by spawning `knit chat` (never write the database from the server), resume, list models (`listModels`); UI with session list and switching, new session, composer with per-turn profile, command palette from `meta.commands`, usage panel from `meta.planUsage` (Claude only: Cursor reports none), the "continue in terminal" command, live timeline using the shared components; all rendered from capabilities, never from an agent's name. Specs S8, S10, S13, S16, D5, D8, D9, D10 | `web/**`, `src/core/ports/session-reader.ts`, `src/adapters/storage/sqlite/session-reader.ts` and test, `src/server/routes/sessions.ts`, `src/server/routes/index.ts`, `src/server/types.ts`, `src/cli/commands/ui.ts`, `src/cli/types.ts`, `test/integration/sessions-ui.test.ts`, `docs/web-interface.md`, `docs/architecture.md` |
| T16 | `feat/config-editor` | Editor for the files the CLIs read, project and global (Claude: `CLAUDE.md`, `.claude/rules/`, `settings.json`; Cursor: `.cursor/rules/`, `~/.cursor/cli-config.json`, `mcp.json`), always showing a diff before saving and backing up the previous version. Spec D5, risk item 2 (permission and settings files). Paths are allow-listed, never free-form. | `web/**`, `src/core/ports/config-files.ts`, `src/adapters/system/config-files.ts` and test, `src/server/routes/config.ts`, `src/server/routes/index.ts`, `src/cli/commands/ui.ts`, `docs/web-interface.md` |
| T17 | `feat/file-explorer` | Read-only file explorer for the target repository and the task worktrees. Specs S17, D11 | `web/**`, `src/core/ports/file-tree.ts`, `src/adapters/system/file-tree.ts` and test, `src/server/routes/files.ts`, `src/server/routes/index.ts`, `src/cli/commands/ui.ts`, `docs/web-interface.md` |

### Wave 5 (from the new tip)

| Task | Branch | What |
| --- | --- | --- |
| T9 | `feat/web-runs-and-control` | Runs list with token totals per agent, UI for the T8 routes (start, abort, resume, retry), empty and error states, keyboard navigation, responsive checks. Specs S2, S5, S9, S13 |
| T13 | `feat/plan-handoff` | A `knit-plan` skill so Claude writes a valid plan and runs `knit validate`; detect the draft plan, show its validation result, launch from the interface, link the run to its session (S15, D7). Open decision for the user: where plan files live (for example `docs/plans/` or `.knit/plans/`) |
| T14 | `feat/live-file-activity` | Files touched during a turn or attempt, from tool-call paths and the worktree's `git status`. Specs S17, D11 |

### Wave 6

| Task | Branch | What |
| --- | --- | --- |
| T18 | `docs/web-interface-close` | `docs/web-interface.md` from design to built, `docs/architecture.md`, `docs/data-model.md`, `docs/status.md`, and the ODD table |

### After everything

Update the ODD, then run once: the independent verifier (for each task that names a high-risk item) and the native review (the user gives consent per candidate), then ask the user for their visual review of the interface.

## Known facts that save time

- Headless Claude sends its reasoning blocks empty; `/usage` through `-p` is answered locally; `--resume` keeps the session id. Headless Cursor exposes no command list and no plan usage; it undercounts input tokens on resumed turns (cache reads not added).
- The SSE id of the stream is the pair `<events>.<agent_events>` because the two tables have separate id sequences.
- `knit abort` signals only a process whose command line is a `knit run` or `knit resume` of the run; group kill only when pgid equals pid.
- `web/` imports board types with `import type` through the `@board` alias only. Vite needs Node 20.19 or newer.
- Chromium for screenshots: `~/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome` with `playwright-core`.

# Resume guide: web interface delivery

Read this first when picking the delivery up in a new session. The source of truth for specs, decisions and the user's verbatim words is [../tasks/web-interface.md](../tasks/web-interface.md). Engram keeps a copy of the state under the topics `odd/web-interface/progress`, `odd/web-interface/tasks` and `odd/web-interface/delivery-d13`.

## Rules that must not be forgotten

- Quota matters to the user: each subagent costs roughly 130k to 270k tokens. Subagents inherit the parent model; set `model: haiku` for mechanical tasks (docs, derivations) and keep Sonnet where analysis or security is involved.
- Commits and PR bodies carry no Claude author or co-author: no `Co-Authored-By`, no "Generated with" footer, nothing about AI. The author is the repository's git user. This overrides any harness attribution reminder.
- Commit messages are one line, `type(scope): description`, scope lowercase letters and hyphens. The user's global hook enforces it.
- Chat replies to the user in neutral Spanish, without voseo. Code, docs, commits and PRs in English.
- Agents never push. The parent pushes and opens PRs. Verification (native review, independent verifier) and the user's visual review happen once, after everything is implemented.
- Do not invent facts about the code: read it. Findings from real calls are in `docs/web-interface.md`.

## State at the time of writing

All 18 tasks are implemented and published as one stack of PRs on `KaelFer29/knit`, each based on the previous branch (retarget to `main` as parents merge): PRs 1 to 12 as in the ODD table, then 13 `feat/web-live-stream` (T7), 14 `feat/file-explorer` (T17), 15 `feat/web-task-detail` (T6), 16 `feat/config-editor` (T16), 17 `feat/web-workspace` (T12), 18 `feat/web-runs-and-control` (T9), 19 `feat/plan-handoff` (T13), 20 `feat/live-file-activity` (T14), 21 `docs/web-interface-close` (T18, the tip). 936 tests, typecheck and build pass on the tip; a few web and spawner tests time out intermittently under the parallel suite and pass on rerun.

## What is left

Only the end-of-delivery verification, once: the independent verifier for the tasks that name a high-risk item (T16 and T17, security), the native review (the user gives consent per candidate), then the user's visual review. Follow-ups listed in `docs/status.md` and in the PR notes (durable run-to-session link, check output not stored, session-level file activity).

## Launching a wave

1. Check `git worktree list` is clean and the checkout is on the tip.
2. One subagent per task: `Agent` tool, `subagent_type: general-purpose`, `isolation: worktree`. The harness worktree starts at `main`, so the prompt must begin with `git switch -c <branch> <base>` and `pnpm install --frozen-lockfile`.
3. The prompt says: read `odd/briefs/agent-brief.md` (and `odd/briefs/agent-brief-web.md` for `web/`), the task row and specs in the ODD, and carries `## Skills to load before work` (`~/.claude/skills/work-unit-commits/SKILL.md`) and `## Allowed edit surfaces` (plain path lines, no prose).
4. Siblings of one wave are based on the same tip and run in parallel.
5. When agents finish, one at a time: `git worktree unlock` and `git worktree remove --force` the agent worktree, delete its `worktree-agent-*` branch, `git rebase <previous tip> <branch>` (conflicts are in `src/cli/main.ts`, `usage.ts`, `types.ts`, `README.md`, `docs/*`: keep both sides), `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`, scan the commits for attribution (`git log --format='%an %ae %cn %ce%n%B' | grep -i -E 'claude|anthropic|co-authored|generated with|noreply|signed-off'`; the file name `CLAUDE.md` in a subject is not attribution), `git push -u origin <branch>`, `gh pr create --base <previous branch> --body-file <file>` with Summary, Notes, Verification and a Chain Context table, and no AI footer.
6. Remove the scratch directories the agents report.

### After everything

Update the ODD, then run once: the independent verifier (for each task that names a high-risk item) and the native review (the user gives consent per candidate), then ask the user for their visual review of the interface.

## Known facts that save time

- Headless Claude sends its reasoning blocks empty; `/usage` through `-p` is answered locally; `--resume` keeps the session id. Headless Cursor exposes no command list and no plan usage; it undercounts input tokens on resumed turns (cache reads not added).
- The SSE id of the stream is the pair `<events>.<agent_events>` because the two tables have separate id sequences.
- `knit abort` signals only a process whose command line is a `knit run` or `knit resume` of the run; group kill only when pgid equals pid.
- `web/` imports board types with `import type` through the `@board` alias only. Vite needs Node 20.19 or newer.
- Chromium for screenshots: `~/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome` with `playwright-core`.

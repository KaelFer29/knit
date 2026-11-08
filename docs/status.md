# Status

Where Knit stands, what is not obvious from the code, and what comes next. Read this first when picking the project up again; the other documents describe how it works.

## What exists

Knit turns a plan into verified, stacked pull requests. A one-shot CLI (not a server) runs each task in its own git worktree on the plan's branch, with the Cursor CLI as implementer. The agent edits and commits its own work; Knit verifies it (process, scope, git hygiene, checks), retries with feedback, and can push and open stacked PRs. It also records everything: a run history in SQLite, the agent's full timeline, and raw transcripts. Commands: `run`, `resume`, `validate`, `runs`, `show`, `logs`, `clean`.

It was verified end to end against the real Cursor CLI. 200 tests pass, and every commit in the history typechecks and passes its own tests.

## Findings that shaped the design

- Headless `agent -p --force --output-format stream-json` is reliable: no hangs in about a dozen real runs. `--force` also satisfies the workspace-trust prompt of a fresh worktree.
- The agent can write outside its working directory, and `agent --sandbox enabled` does not prevent it (tested). The only defence is Knit's scope check, which sees the worktree and anything created next to it, not the rest of the disk or ignored files.
- The Cursor CLI loads your MCP servers in every run. With a memory server enabled, each task spent tokens on it and wrote memories from throwaway worktrees. Disable with `agent mcp disable <server>`; the prompt is self-contained, so the agent does not need memory.
- Node 20 forces older dependencies (`better-sqlite3` 11, `vitest` 3); TypeScript 7 needs an explicit `rootDir`; pnpm 10 needs `better-sqlite3` in `onlyBuiltDependencies`.
- The author's global commit hook accepts `type(scope): description` with the scope limited to lowercase letters and hyphens, so task branches and agent commits follow the same set of types.

## Conventions

- Chat replies in neutral Spanish without voseo (see `CLAUDE.md`); code, comments, docs and commits in English.
- Commits are `type(scope): description`, one line, no body, no co-author trailers, grouped by work unit with their tests and docs.
- Unit tests sit next to the module they test; `test/integration/` is for tests that cross layers.

## Next steps

1. **Interface.** A separate process that reads the SQLite database (WAL allows reading while a run writes). Poll `agent_events` for `id > last_seen` to show Cursor's thinking, messages and tool calls live; `events`, `tasks` and `attempts` give the run view. `knit logs --follow` is the terminal reference (`src/cli/commands/logs.ts`). See [data-model.md](data-model.md). It is observation only: headless mode is one-shot, so intervening means aborting and resuming.
2. **A Claude Code skill** so a planning session can write a plan, run `knit validate`, launch the run in the background and read the result.
3. **A first real run on a real project** with a minimal docs-only task, since the agent has no sandbox.
4. Smaller items: a `LICENSE`, continue independent tasks after a failure, a `claude -p` adapter for planner or verifier roles, and measuring token cost on real tasks.

## Picking it up

```bash
pnpm install && pnpm build && pnpm test
node dist/cli/index.js run examples/plans/hello-greet.md --dry-run
```

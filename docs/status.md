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

Project-wide rules (language, commits, where to look) live in `CLAUDE.md`, which every session loads. Per-layer rules live in `.claude/rules/` and load only when a file of that layer is opened. Active features are tracked in `odd/tasks/<feature>.md`.

## Next steps

1. **Web interface** (in progress): Knit becomes one workspace for planning with Claude, orchestrating and implementing with Cursor. Design in [web-interface.md](web-interface.md); specs, phases and tasks in [../odd/tasks/web-interface.md](../odd/tasks/web-interface.md). `knit logs --follow` (`src/cli/commands/logs.ts`) is the terminal reference for the live timeline.
2. **A `knit-plan` skill** so Claude writes a valid plan and runs `knit validate`; now part of the interface's plan handoff (task T13).
3. **A first real run on a real project** with a minimal docs-only task, since the agent has no sandbox.
4. Smaller items: a `LICENSE`, continue independent tasks after a failure, a `claude -p` adapter for planner or verifier roles, and measuring token cost on real tasks.

## Picking it up

```bash
pnpm install && pnpm build && pnpm test
node dist/cli/index.js run examples/plans/hello-greet.md --dry-run
```

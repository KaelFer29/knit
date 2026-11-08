# Status

Where Knit stands, what is not obvious from the code, and what comes next. Read this first when picking the project up again; the other documents describe how it works.

## What exists

Knit turns a plan into verified, stacked pull requests. A one-shot CLI (not a server) runs each task in its own git worktree on the plan's branch, with the Cursor CLI as implementer. The agent edits and commits its own work; Knit verifies it (process, scope, git hygiene, checks), retries with feedback, and can push and open stacked PRs. It also records everything: a run history in SQLite, the agent's full timeline, and raw transcripts. Commands: `run`, `resume`, `validate`, `runs`, `show`, `logs`, `clean`.

`knit ui` serves a web app on `127.0.0.1` with four pages: runs (live canvas, start, abort, resume, retry, task diffs), workspace (chat sessions with Claude and Cursor, plan drafts launched as runs), configuration (Claude and Cursor files, diff before saving) and a read-only file explorer. Chat turns run through `knit chat` (Claude by default, `claude -p` with the subscription), and `knit followup` sends more work to a task's Cursor chat.

The run loop was verified end to end against the real Cursor CLI. On the branch `docs/web-interface-close`, `pnpm typecheck`, `pnpm test` (936 tests in 84 files) and `pnpm build` pass. Every commit typechecks and passes its own tests.

## Findings that shaped the design

- Headless `agent -p --force --output-format stream-json` is reliable: no hangs in about a dozen real runs. `--force` also satisfies the workspace-trust prompt of a fresh worktree.
- The agent can write outside its working directory, and `agent --sandbox enabled` does not prevent it (tested). The only defence is Knit's scope check, which sees the worktree and anything created next to it, not the rest of the disk or ignored files.
- The Cursor CLI loads your MCP servers in every run. With a memory server enabled, each task spent tokens on it and wrote memories from throwaway worktrees. Disable with `agent mcp disable <server>`; the prompt is self-contained, so the agent does not need memory.
- Node 20 forces older dependencies (`better-sqlite3` 11, `vitest` 3); TypeScript 7 needs an explicit `rootDir`; pnpm 10 needs `better-sqlite3` in `onlyBuiltDependencies`.
- The author's global commit hook accepts `type(scope): description` with the scope limited to lowercase letters and hyphens, so task branches and agent commits follow the same set of types.

## Conventions

Project-wide rules (language, commits, where to look) live in `CLAUDE.md`, which every session loads. Per-layer rules live in `.claude/rules/` and load only when a file of that layer is opened. Active features are tracked in `odd/tasks/<feature>.md`.

## Next steps

### Done

- The web interface, tasks T1 to T17: the read side, `knit ui`, the canvas with live data, detail panels, runs and run control, the workspace and plan handoff, the configuration editor, the file explorer, and live file activity for task attempts. Known limits are in [web-interface.md](web-interface.md#known-limits-and-follow-ups).
- The `knit-plan` skill (T13): Claude writes a valid plan and runs `knit validate`.

### Pending

1. **Verification of the web interface**: an independent verifier for each task that names a high-risk item, then the native review, each with the user's consent per candidate.
2. **The user's visual review** of the interface, once everything is implemented.
3. **Interactive `claude --resume` of a `-p` session** is not verified: it cannot be tested headless. Session resume from the terminal rests on it (D10).
4. **Known limits** of the web interface (see the link above), for example session-level file activity and polling for sessions.
5. **A first real run on a real project** with a minimal docs-only task, since the agent has no sandbox.
6. Smaller items: a `LICENSE`, continue independent tasks after a failure, a verifier role for Claude, and measuring token cost on real tasks.

## Picking it up

```bash
pnpm install && pnpm build && pnpm test
node dist/cli/index.js run examples/plans/hello-greet.md --dry-run
```

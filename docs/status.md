# Status

Where Knit stands, what is not obvious from the code, and what comes next. Read this first when picking the project up again; the other documents describe how it works.

## What exists

Knit turns a plan into verified, stacked pull requests. A one-shot CLI (not a server) runs each task in its own git worktree on the plan's branch, with the Cursor CLI as implementer. The agent edits and commits its own work; Knit verifies it (process, scope, git hygiene, checks), retries with feedback, and can push and open stacked PRs. It also records everything: a run history in SQLite, the agent's full timeline, and raw transcripts. Commands: `run`, `resume`, `validate`, `runs`, `show`, `logs`, `clean`, `abort`, `chat`, `followup`, `branch`, `ui`.

`knit ui` serves a web app on `127.0.0.1` that opens on one single view: three light blocks joined by an animated pipeline, Claude (the planner), the Orchestrator (Knit) and Cursor (the builder). Each block opens a modal. Claude's modal is a Claude Code style chat with session history, model and effort pickers, plan usage bars and a switch that routes the prompt to the orchestrator; a plan Claude writes shows as a draft over the chat and is sent to Knit with one click (everything starts from Claude; there is no "start a run" form). Cursor's modal is watched, not written to: state, summary, context use, the active task open and the others as collapsed rows, and a Branches tab where each branch is a compact row: undo it (revert, reset, delete), test it in the user's own repository (`git checkout` of the branch, after freeing its worktree), or open its pull request into the branch the person picks, with a description built from the task and the corrections of its follow-ups. A branch whose pull request was merged shows it in purple, and new commits after the merge are flagged. From Claude's modal the person can also iterate on a delivered task: they write what to change, Claude turns it into an instruction for Cursor, and one click sends it to the orchestrator, which continues the same Cursor chat on the same branch. The configuration editor opens as a preview. The theme is light only. Claude picks Cursor's model per task with an optional `Model:` line in the plan. Chat turns run through `knit chat`, more work for a task through `knit followup` (on the same chat and branch), and branch actions through `knit branch`. Retries reuse the Cursor chat while it has room under 70% of its window, and then open a fresh one with the whole task.

The run loop was verified end to end against the real Cursor CLI. All the work up to PR #38 is merged into `main` (PR #37 the context work, #38 the branch and iteration work, both by merge commit). `pnpm typecheck`, `pnpm test` (1335 tests) and `pnpm build` pass; the repository has no CI, so these run locally. Every commit typechecks and passes its own tests.

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

- The web interface, tasks T1 to T17: the read side, `knit ui`, the canvas with live data, detail panels, runs and run control, the workspace and plan handoff, the configuration editor, the file explorer, and live file activity for task attempts. Then the single view (feature `odd/tasks/web-single-view.md`), then its polish and identity pass (feature `odd/tasks/web-polish.md`: block redesign, modals, light theme, per-task model, changed files by task, undo and pull requests from the Cursor modal): one screen with the Claude, Knit and Cursor blocks joined by an animated pipeline, side panels for each, the configuration as a preview with an editor that keeps its undo history, and `/usage` sent as a turn. Known limits are in [web-interface.md](web-interface.md#known-limits-and-follow-ups).
- Lists that scale (feature `odd/tasks/web-scale.md`): the runs picker, the branches and the tasks of the Cursor modal are compact, paged and searchable; detail opens on demand. See [web-interface.md](web-interface.md#lists-that-scale).
- Cursor context, step 1 (feature `odd/tasks/cursor-context.md`): the context each attempt's chat carries (`input + cacheRead + cacheWrite` of the result's usage) is measured by the runner, recorded in `attempt.finished` and shown as Context in the Cursor modal, the block details and each attempt. No schema change. Step 2 (feature `odd/tasks/cursor-context.md`): a retry of a task resumes the previous attempt's chat with a feedback-only prompt while it is under 70% of its window, and opens a fresh chat with the whole task (the deterministic handoff) when it is not; `knit followup` warns when its chat passes the threshold. Reusing a chat across tasks is not done: it needs `--resume` verified across worktrees with the real CLI.
- Test a branch and iterate on it (feature `odd/tasks/test-branch.md`): a "Test this branch" action frees the task's worktree and runs `git checkout` of its branch in the user's repository (`knit branch … checkout`), and "Return repository to <branch>" switches it back (`knit branch … return`); `knit followup` recreates a missing worktree from the branch; `POST /api/runs/:id/tasks/:task/followup` starts a follow-up; Claude's modal lists the delivered tasks to iterate on and turns what the person asks into an instruction for Cursor that is sent to the orchestrator with one click.
- The `knit-plan` skill (T13): Claude writes a valid plan and runs `knit validate`.

### Pending

1. **Installing `knit` outside this repository.** The package is `private`, has a `bin` entry but no publication and no global install, so `knit` runs only from a checkout after `pnpm build`.
2. **Real Cursor, partly verified.** On a throwaway repository, a real run retried a task and resumed its chat (`chat: resumed`), a follow-up ran after its worktree was freed, and the checkout and return of a branch in the user's repository worked. Not yet on a real project of the user's, and the live animation of a follow-up was not seen on a real run.
3. **Visual check of the newest parts in a browser.** The iteration bar, the checkout notice and the "N new commits" pill were checked with Chromium on sample data, and the notice and the pill only through tests. The live animation after a follow-up was not seen on a real run.
4. **Reusing a chat across tasks is not done.** Each task has its own worktree and branch. It needs `--resume` verified across worktrees with the real CLI, and it can carry stale context between tasks. Also open: a `--fresh-chats` switch to force new chats.
5. **Follow-ups recorded before this change have no prompt**, so a second pull request built from them does not list their corrections. Only the follow-ups from now on are described.
6. **Known limits of the branches tab**: "On origin" is a local tracking ref (can be stale); no undo on origin; a pull request can be opened for a failed task only through its follow-up; a follow-up that dies without its end event leaves its task looking busy.
7. **Interactive `claude --resume` of a `-p` session** is not verified: it cannot be tested headless. Session resume from the terminal rests on it (D10).
8. **Known limits** of the web interface (see the link above): session-level file activity, and polling for sessions.
9. **A first real run on a real project** with a minimal docs-only task, since the agent has no sandbox.
10. **Returning the repository to its branch** works from the branches tab and the CLI (`knit branch … return`), for a checkout made from now on. Checkouts made before it recorded the branch the repository was on have no button: switch back by hand once.
11. Smaller items: a `LICENSE`, continue independent tasks after a failure, a verifier role for Claude, and measuring token cost on real tasks.

## Picking it up

```bash
pnpm install && pnpm build && pnpm test
node dist/cli/index.js run examples/plans/hello-greet.md --dry-run
```

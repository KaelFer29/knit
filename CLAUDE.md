# Knit project rules

Knit joins Claude and Cursor into one workflow: plan with Claude, orchestrate with Knit, implement with Cursor. Today it is a one-shot TypeScript CLI that turns a plan into verified, stacked pull requests; the web interface (`knit ui`) is in progress. This file stays small: it is loaded in every session. Detail lives in the places listed under "Where to look".

## Language

- Reply to the user in neutral Spanish. Do not use voseo (no "vos", "querés", "tenés", "dale"); use "tú" forms or impersonal phrasing instead.
- This applies to chat replies only. Code, comments, docs and commit messages stay in English.

## Always

- Commits: `type(scope): description`, one line, no body, no co-author or AI trailers. Scope is lowercase letters and hyphens only. Group by work unit, with tests and docs alongside the code.
- Every commit typechecks and passes its own tests: `pnpm typecheck && pnpm test`.
- When you add or change a command, option or message, update `src/cli/usage.ts` and the docs in the same commit.

## Where to look

| When you... | Read |
| --- | --- |
| pick the project up again | `docs/status.md` |
| work on an active feature | its document in `odd/tasks/` |
| need the layers, ports or where to add things | `docs/architecture.md` |
| touch runs, verification, delivery or resume | `docs/run-lifecycle.md` |
| read or change what a run records | `docs/data-model.md` |
| write or parse a plan | `docs/plan-format.md` |
| work on the web interface (`knit ui`) | `docs/web-interface.md` |

Layer rules in `.claude/rules/` load automatically when you open a file of that layer.

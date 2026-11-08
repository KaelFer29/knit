# Brief shared by every Knit delivery agent

You implement ONE task of the Knit web-interface feature, in your own git worktree and branch. Other agents work in parallel on other tasks; you cannot see them. Reply in English.

## 1. Setup (first thing you do)

1. You are in an isolated git worktree of /home/kael/orquestador. Create your branch from the base branch named in your task: `git switch -c <branch> <base-branch>`.
2. Keep local noise out of git: `echo node_modules >> "$(git rev-parse --git-path info/exclude)"; echo dist >> "$(git rev-parse --git-path info/exclude)"`.
3. Install dependencies: `pnpm install --frozen-lockfile --offline`. If that fails and your task adds no dependency, run `ln -s /home/kael/orquestador/node_modules node_modules`. Network is allowed only for dependencies your task explicitly adds.
4. Confirm the baseline is green before you change anything: `pnpm typecheck && pnpm test`.

## 2. Read before writing

- `odd/tasks/web-interface.md` up to the `## Log` heading: the specs (S#), decisions (D#), the delivery plan and the task table. Your task row says what to build and which S# it covers.
- `docs/web-interface.md` (design) and `docs/architecture.md` (layers). `CLAUDE.md` and the `.claude/rules/*.md` of the layers you touch apply to you.
- The existing code you will extend. Reuse existing helpers for shared state; never re-implement them with a different shape.

## 3. Scope

- Edit only the paths under `## Allowed edit surfaces` in your task. If something outside them must change, do not change it: describe it in your report.
- Do NOT edit `odd/tasks/web-interface.md`: the parent owns it.
- No unrelated refactors, no reformatting of files you do not otherwise change, no new requirements beyond your S#.
- Never read or write `~/.knit` or any real data directory. Use scratch directories created with `mktemp -d`. Do not delete them: list them in your report.

## 4. Method

- Test first: write the tests for the behaviour, watch them fail for the right reason (RED), implement (GREEN), then tidy. Unit tests sit next to the module (`foo.ts`, `foo.test.ts`); tests that cross layers go in `test/integration/`. Test through the public interface; assert every observable effect (output, exit code, persisted data).
- When you add or change a command, option, message or port, update the help text (`src/cli/usage.ts`) and the docs in the same commit.
- If you change code that other behaviour already uses (shared helpers, parsers, ports), run a differential check: build the base commit in a scratch copy and compare stdout, stderr and exit code of the existing commands against your branch; fix any difference nobody asked for.
- Gates before you finish, all green: `pnpm typecheck`, `pnpm test`, `pnpm build`.

## 5. Commits (read twice)

- Format `type(scope): description`: one line, no body. `type` is one of `feat, fix, refactor, docs, chore, test`; `scope` uses only lowercase letters and hyphens. The user's global commit hook rejects anything else.
- NO trailers of any kind: no `Co-Authored-By`, no `Signed-off-by`, no "Generated with" line, no mention of Claude, Anthropic or any AI anywhere in a commit message. The commits are authored by the repository's git user (Kael); never change git config and never pass `--author`.
- Commit as reviewable work units of about 400 changed lines or fewer, each with its tests and docs. If one coherent unit is larger, keep it together and explain why in the report.
- Stage explicit paths (`git add <path>`), never `git add -A` or `git add .`.
- Never push, never open a pull request, never merge, never switch to or modify another branch, never force anything. The parent pushes and opens PRs.

## 6. Report (your final message)

1. Branch name and `git log --oneline <base-branch>..HEAD`.
2. `<command>: <observed result>` for `pnpm typecheck`, `pnpm test` (with counts) and `pnpm build`, plus any differential check.
3. Which S# and D# you covered, and which you could not, with the reason.
4. Deviations from the task, assumptions, open issues, and anything outside your allowed surfaces that needs a change.
5. `Risk: item N (reason)` or `Risk: none`, using the ODD's high-risk list.
6. Exact paths of any scratch directories you created.
7. A closing `## Key Learnings` block of 1-5 numbered items, each a standalone factual sentence of at least 20 characters and at least 4 words; omit it if there is genuinely no reusable learning.

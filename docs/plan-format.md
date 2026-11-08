# Plan format

One Markdown file per plan. Tasks run sequentially in file order. See `examples/plans/` for complete samples.

```markdown
# Plan: <name>

Repo: <optional; path of the target repository, relative paths resolve against the plan file>
Base: <optional; ref the first branches start from, default: the repo's current commit>
Setup:
- <optional; shell command run in every fresh worktree before the agent, e.g. pnpm install>

## T1: <short title>

Branch: <type>/<slug>
Depends: <optional; one earlier task ID>
Goal: <one sentence>
Specs:
- S1: <exact requirement, quoted verbatim from the user>
Allowed files:
- <repo-relative path or narrow glob>
Checks:
- <shell command, run from the worktree root>
```

## Rules

- `T<n>` IDs are unique. Order in the file is execution order.
- `Repo` is optional. When omitted, the repository of the directory the command runs from is used. When present, a relative path resolves against the plan file.
- `Branch` is required: `type/slug` where type is one of `feat`, `fix`, `refactor`, `docs`, `chore`, `test` (the same set the commit hook accepts) and the slug uses lowercase letters, digits, dots and hyphens. Branches are unique within a plan and must not exist yet in the repository.
- `Depends` names one task declared earlier. Without it, the branch starts from the plan base (so it is independent and its PR targets the base branch). With it, the branch starts from the parent's branch (stacked: its PR targets the parent's branch).
- `Specs` are quoted, never paraphrased. The agent must not add requirements.
- `Allowed files` is mandatory and non-empty. No `.`, no repo root, no `..`, no absolute paths, no wildcard-only globs. `dir/` allows everything under `dir`; `*`, `**` and `?` are supported.
- `Checks` may be empty: the task is then accepted on a clean run plus the scope and git checks.
- `Setup` is optional. A fresh worktree has no `node_modules` or other ignored files, so checks that need them require a setup command. A failing setup fails the task without calling the agent (recorded as attempt 0).
- Parsing errors stop the run before anything is created; all issues are reported together. `knit validate <plan>` checks a file without running anything.

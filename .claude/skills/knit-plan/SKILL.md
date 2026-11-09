---
name: knit-plan
description: Write a development plan in the Knit plan format and validate it with `knit validate`. Use only when the user has a finished plan for work that should be implemented (not for questions, research or exploration), or asks for a Knit plan.
---

# knit-plan

Turn a finished plan into a Knit plan file. Knit runs it task by task, verifies each one and opens stacked pull requests.

## When to use

Only when the user wants development done and the plan is ready. A conversation that does not end in implementation needs no plan file. Never start a run yourself: the user launches it from the Knit interface or with `knit run`.

## Steps

1. Confirm scope with the user if tasks, specs or checks are unclear. Quote their exact requirements in `Specs`; do not invent requirements.
2. Write the plan to `docs/plans/<slug>.md` inside the repository you are working in (create the directory if needed). `<slug>` uses lowercase letters, digits and hyphens.
3. Follow this format exactly (full rules: `docs/plan-format.md` of the Knit repository):

```markdown
# Plan: <name>

Base: <optional; ref the first branches start from>
Setup:
- <optional; shell command run in every fresh worktree, e.g. pnpm install>

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

   - Omit `Repo`: the plan then targets the repository it sits in.
   - `T<n>` IDs are unique and the file order is the execution order.
   - `Branch` is `type/slug` with type one of `feat`, `fix`, `refactor`, `docs`, `chore`, `test`; the slug uses lowercase letters, digits, dots and hyphens. Branches are unique and must not exist yet.
   - `Depends` names one task declared earlier; without it the branch starts from the plan base.
   - Each task must be self-contained: the implementing agent sees only its own task, with no memory of this conversation. Put in `Goal` and `Specs` everything it needs.
   - `Allowed files` stays narrow; `Checks` are deterministic commands that fail when the task is not done.
4. Run `knit validate docs/plans/<slug>.md`. If it reports issues, fix every one and run it again until it passes. If `knit` is not installed, say so and do not claim the plan is valid.
5. Tell the user the plan path and that it appears as a draft in the Knit interface (session view), where they launch it. Do not run `knit run`.

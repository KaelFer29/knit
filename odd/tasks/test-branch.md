# Test a branch, and iterate on it without a new branch

Objective: make it easy to test what Cursor did (a "Test this branch" action that ends in a plain `git checkout`), and to keep iterating on the same branch from the interface. Branch: `feat/test-branch` (stacked on `feat/cursor-context`). Delivery: sequential, inline; commits per work unit, no AI attribution. Test runner: vitest (`pnpm test`), plus `pnpm typecheck` and `pnpm build`.

## Specs

- **S1. Test a branch.** "para poder probar los cambios hechos por Cursor, me gustaría que sea tan facil como hacer git checkout [nombre de la rama], ¿Sería posible? Quiero que sea sencillo poder probar los cambios en mi aplicación de Cursor o por ejemplo VS." Evidence: while Cursor's worktree holds the branch, `git checkout <branch>` answers `fatal: '<branch>' is already used by worktree at …`; after the worktree is removed (the branch stays) it works. Decision: a "Test this branch" action frees the worktree (never forced), refuses when either checkout has uncommitted changes, and switches the user's repository to the branch.
- **S2. Iterate on the same branch.** "¿Qué pasa si no me gustó la implementación de la rama que realizó Cursor y quiero seguir iterando en esta rama con tareas? [...] ¿Implementamos una lista de tareas realizadas en el modal de Claude que me permitan seguir iterando en esta rama y que vuelva a pasar al orquestador la iteración de esta rama con los detalles sin necesidad de crear otra rama y de cambiar de sesión?" Cursor stays watched, not written to (earlier decision): the iteration goes Claude modal, then orchestrator (`knit followup`), same branch and same Cursor chat.
- **S3. A follow-up recreates a missing worktree.** A branch lives in one place at a time, so after testing it in the main checkout the worktree is gone; `followup` must recreate it from the branch, and say what to do when the branch is still checked out in the user's repository.
- **S4. Known limit.** A follow-up is verified against the plan snapshot: a change that needs files outside the task's allowed files fails the scope check.

## Tasks

| ID | Specs | What | Route | Status | Commit |
| --- | --- | --- | --- | --- | --- |
| B1 | S1 | Pure rule `decideCheckout`, `BranchState.checkedOut`, `GitBranchTools.checkout`, `checkout` in the branch overview | inline | done (RED seen: 7 rule, 7 adapter, 2 overview tests) | 5f62df8 |
| B2 | S1 | `knit branch … checkout` (dry run until `--yes`), the route, and the "Test this branch" action in the branch row | inline | done (RED seen: 5 CLI, 1 route, 4 page tests) | see git log |
| B3 | S3 | `Workspace.restore` and `knit followup` recreating a missing worktree | inline | pending | |
| B4 | S2 | `POST /api/runs/:id/tasks/:task/followup` | inline | pending | |
| B5 | S2 | Claude modal: list of delivered tasks to iterate on, with their context, sent to the orchestrator as a follow-up | inline | pending | |

Route evidence: sequential work, no Writer trigger applies.

## Log

- **L1** (2026-11-09, user, verbatim): "Perfecto, solo tengo algunas dudas. ¿Qué pasa si no me gustó la implementación de la rama que realizó Cursor y quiero seguir iterando en esta rama con tareas? ¿Debería de trabajar directamente aqui en el modal de cursor permitiendome enviarle prompts directamente? ¿Implementamos una lista de tareas realizadas en el modal de Claude que me permitan seguir iterando en esta rama y que vuelva a pasar al orquestador la iteración de esta rama con los detalles sin necesidad de crear otra rama y de cambiar de sesión? Lo otro, para poder probar los cambios hechos por Cursor, me gustaría que sea tan facil como hacer git checkout [nombre de la rama], ¿Sería posible? Quiero que sea sencillo poder probar los cambios en mi aplicación de Cursor o por ejemplo VS." and "Perfecto, me parece bien esta planificación." (order: the test action with the worktree recreation first, then the iteration list).

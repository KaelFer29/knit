# Web interface: lists that scale

Objective: make the runs list, the branches and the changed files of `knit ui` usable with many items: compact rows, pagination, a text filter, detail on demand. Branch: `feat/scalable-lists`. Delivery: sequential, inline; commits per work unit, no AI attribution. Test runner: vitest (`pnpm test`), plus `pnpm typecheck` and `pnpm build`.

## Specs

- **S1. Runs.** "el orquestador, tiene bloques o tarjetas demasiado grandes de las RUN y sin paginación, ten en cuenta que en un proyecto pueden llegar a haber muchas". Runs become compact one-line rows, paginated, with a text filter and a status filter.
- **S2. Branches.** "lo mismo de las ramas". Each branch is one compact row (task, branch, state chips); its commits and actions open on demand; paginated with a text filter.
- **S3. Changed files.** "en el modal de Cursor, sus bloques dentro del modal como los cambios, las ramas, es demasiado grande y poco escalable visualmente". Changes are grouped by task, collapsed by default with file and line counts; paginated.
- **S4. Overall.** "necesito full flexibilidad y visibilidad clara, solo lo que me interesa, no ruido visual." Nothing new is shown by default beyond what identifies and states each item.

## Tasks

| ID | Specs | What | Route | Status | Commit |
| --- | --- | --- | --- | --- | --- |
| L1 | S1-S4 | Pure list helpers (`paginate`, `matches`) and a `Pager` + `ListToolbar` molecule | inline | pending | |
| L2 | S1 | Compact paginated runs picker with filters | inline | pending | |
| L3 | S2 | Compact collapsible branch rows, paginated and filtered | inline | pending | |
| L4 | S3 | Changed files: collapsed groups with counts, paginated | inline | pending | |

Route evidence: sequential work, no Writer trigger applies.

## Log

- **L1** (2026-11-09, user, verbatim): "Aún no me convence del todo la interfaz visual, sí me gusta la visual de los bloques y modales, pero falta mucho por pulir. Por ejemplo el orquestador, tiene bloques o tarjetas demasiado grandes de las RUN y sin paginación, ten en cuenta que en un proyecto pueden llegar a haber muchas, lo mismo de las ramas y en el modal de Cursor, sus bloques dentro del modal como los cambios, las ramas, es demasiado grande y poco escalable visualmente. [...] En conclusión, necesito full flexibilidad y visibilidad clara, solo lo que me interesa, no ruido visual." and "Comienza puliendo la interfaz, después vemos lo del punto 2."
- **L2** (2026-11-09) Out of scope for now: dynamic Cursor context management (point 2) and a Cursor extension panel (point 3).

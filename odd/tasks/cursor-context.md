# Cursor context: measure it, then switch chats only when needed

Objective: know how much context each Cursor chat carries and show it (step 1); later, switch to a fresh chat with a handoff only when the chat nears its margin (step 2, separate decision). Branch: `feat/cursor-context`. Delivery: sequential, inline; commits per work unit, no AI attribution. Test runner: vitest (`pnpm test`), plus `pnpm typecheck` and `pnpm build`.

## Specs

- **S1. Measure and show.** "necesito que se optimice dinamicamente en base a los tokens dentro de Cursor y su margen, y así se haga un cambio de chat o una compresión correspondiente dentro de Cursor, con lo que necesita saber. Solo cuando es necesario, para no ir cambiando siempre de sesión o de chat dentro de Cursor por cada funcionalidad." Step 1 (agreed: "Perfecto, me parece bien"): measure the context of each attempt's chat and show it, without changing behavior. The context is `inputTokens + cacheReadTokens + cacheWriteTokens` of the attempt's `result` usage (evidence: `stream-resume.jsonl`, turn 2: 93 input + 12288 cache read).
- **S2. Switch only when needed (NOT in this step).** A fresh chat with a deterministic handoff (goal, specs, earlier tasks' commits; no tokens) once the chat passes a threshold (proposed 70% of the window), only between tasks.
- **S3. No schema change.** The measure travels in the payload of the `attempt.finished` event, which is free-form JSON; no migration.

## Tasks

| ID | Specs | What | Route | Status | Commit |
| --- | --- | --- | --- | --- | --- |
| C1 | S1 | Pure `core/context`: context of a usage, window of a model, share | inline | done (RED seen) | see git log |
| C2 | S1, S3 | Cursor runner reports `contextTokens`; the run loop and follow-ups record it in `attempt.finished`; the board carries it per attempt and as `BoardModel.context` | inline | done (RED seen: runner, run loop, board) | see git log |
| C3 | S1 | Web: Context in the Cursor modal summary, the block details and each attempt | inline | done (RED seen: 5 tests); not looked at in a browser | see git log |

Route evidence: sequential work, no Writer trigger applies. Risk: no persisted format change (S3), so no high-risk item.

## Log

- **L1** (2026-11-09, user, verbatim): "Yo me imagino este proyecto como un 'reemplazo' a tener que andar moviendome de Cursor y Claude entre la extensión y el chat, copiando yo los mismos prompt entre modelos, cambiando de chats, optimizando tokens, etc. [...] cosa que parece no estar, para optimizar tokens y demás dentro de Cursor, como su espacio de contexto, necesito que se optimice dinamicamente en base a los tokens dentro de Cursor y su margen, y así se haga un cambio de chat o una compresión correspondiente dentro de Cursor, con lo que necesita saber. Solo cuando es necesario, para no ir cambiando siempre de sesión o de chat dentro de Cursor por cada funcionalidad." and "Perfecto, me parece bien." (to: measure and show first, then the switch).
- **L2** (2026-11-09) Evidence: the CLI reports no window size and has no compaction command; `--resume <chatId>` and `create-chat` exist; some model ids carry the window (`[context=1m]`). The runner keeps only `inputTokens` and `outputTokens` (`cursor-runner.ts:134`), so the context of a resumed chat was under-reported.
- **L3** (2026-11-09) Finding: the plan format only admits plain model ids (`[A-Za-z0-9._:/-]`), so a plan cannot write `model[context=1m]` even though the CLI takes it. The window is therefore the assumed default (200k) for every plan model, flagged as assumed. Allowing bracketed ids in plans is a separate decision (validation of the plan format).

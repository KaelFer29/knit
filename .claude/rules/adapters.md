---
paths:
  - "src/adapters/**"
---

# Adapters layer

- An adapter implements one port from `src/core/ports/`. It may import ports and core types, never another adapter's internals or the CLI.
- Place it by role: `agents/<name>/`, `vcs/<tool>/`, `checks/<kind>/`, `storage/<kind>/`, `system/`.
- Long-running or streaming processes (agents, checks) go through `src/adapters/system/spawn-with-timeout.ts` for timeouts and process-group kill. Short synchronous tool calls (`git`, `gh`) use `execFileSync`/`spawnSync` with an argument array, never a shell string.
- Adapter tests use fake binaries in a sibling `__fixtures__/` folder instead of the real `agent` or `gh`.
- Scratch git repos never touch the user's global config or hooks: pass `-c core.hooksPath=/dev/null` and explicit `user.name`/`user.email`.
- SQLite schema changes bump `user_version`, migrate older databases in place and update `docs/data-model.md`.

---
paths:
  - "src/cli/**"
  - "test/integration/**"
---

# CLI layer

- The CLI is the only place where adapters are chosen and wired into the core (`src/cli/commands/execute.ts`).
- One module per command in `src/cli/commands/`; route it in `src/cli/main.ts` and describe it in `src/cli/usage.ts`.
- Commands receive `CliIo`, `CliDeps` and `env` instead of reaching for `process` globals, so integration tests can drive them.
- Shared parsing, paths and formatting belong in `src/cli/support/`.
- `test/integration/` runs the CLI against real git and SQLite in `mktemp`-style temp dirs; never against the user's `~/.knit`.

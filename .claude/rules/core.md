---
paths:
  - "src/core/**"
---

# Core layer

- Pure logic, no I/O. `src/core` imports nothing outside `src/core`: no `node:fs`, `node:child_process`, adapters or CLI modules.
- The core talks to the outside world only through the interfaces in `src/core/ports/`. A new need means a new or extended port, never a direct import.
- A new acceptance rule is a pure function under `src/core/verification/`, called from `src/core/run/run-plan.ts`.
- Test with in-memory fakes of the ports, never with real git, SQLite or processes.
- Changing a port is a contract change: update every adapter that implements it and `docs/architecture.md`.

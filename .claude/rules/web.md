---
paths:
  - "web/**"
  - "src/server/**"
  - "src/core/board/**"
---

# Web interface

Design: `docs/web-interface.md`. Active work: `odd/tasks/web-interface.md`.

- `src/server` reads the database only through the `RunReader` port (read-only connection). It changes state only by starting Knit or agent processes, never by writing SQLite.
- The server binds to `127.0.0.1`, requires the launch token on every request and checks `Origin`/`Host` on every `POST`. Never relax these.
- `web/` talks only to the HTTP API; never to SQLite or the file system.
- View state (queued, running, retrying, verifying, delivered) is computed in `src/core/board/` as pure functions with unit tests, not inside components.
- Container components fetch and subscribe; presentational components only render props. Organize as atoms, molecules, organisms.
- Agent output is untrusted: render as text, sanitize any Markdown, never set raw HTML.
- Color only for agent identity and status; spacing, color and type come from design tokens. Every animation honors `prefers-reduced-motion`.
- Render agent features from the adapter's declared capabilities, never by checking the agent's name (no `agent === "claude"` branches). One session, turn and timeline model serves every agent.
- Agent identities (name, brand color, icon) live in one module; do not hardcode them in components. Logo files live in git-ignored `web/public/brand/`; never commit them, always keep the monogram fallback.

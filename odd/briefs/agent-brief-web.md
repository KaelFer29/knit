# Extra brief for agents that build the web interface (`web/`)

Read this after `agent-brief.md`. It applies to every task that adds or changes files under `web/`.

## What the user asked for (S2, S7)

"una interfaz minimalista y moderna, sin tanto ruido visual pero que sea bonita e intuitiva visualmente. Con una gran UI/UX." Neutral surfaces; color only for agent identity and status; light and dark themes from design tokens; usable from 1280 px down to 768 px without horizontal scroll; keyboard navigation and a visible focus ring on every interactive element. Claude and Cursor keep their own icon, label and brand color (identity module); official logo files live in git-ignored `web/public/brand/` and the block falls back to a monogram when a file is missing. Never commit logo files.

## Conventions (see also `.claude/rules/web.md`)

- Vite + React + TypeScript in `web/`, built to `dist/web`. Container components fetch and subscribe; presentational components only render props. Organize as atoms, molecules, organisms.
- The view state (queued, running, retrying, verifying, delivered, failed) comes from `src/core/board` (pure). Import its types with `import type` only; never import runtime code from `src/` into `web/`, and never import Node modules in `web/`.
- Render features from the agent capabilities, never by checking the agent's name.
- Agent output is untrusted: render as text; sanitize any Markdown; never set raw HTML.
- Color, spacing, radius, type scale and motion come from design tokens (CSS custom properties) with light and dark values; no hard-coded colors in components.
- Every animation is disabled under `prefers-reduced-motion`.
- Tests: Vitest with a DOM environment for components and hooks, written first like any other code.

## Looking at your work (mandatory for visual changes)

You cannot judge a layout from code. Build, serve and screenshot it, then look at the images with the Read tool and fix what you see.

- Chromium is already installed. Do not download another browser. Use `playwright-core` (add it as a dev dependency if the task allows new dependencies, otherwise use a scratch copy outside the repo) and launch it with
  `executablePath: "/home/kael/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome"` and `args: ["--no-sandbox"]`.
- Take screenshots at 1440x900, 1280x800 and 768x1024, in light and dark (`colorScheme`), and at least one with `reducedMotion: "reduce"`. Save them in a scratch directory under the system temp dir, not in the repo, and list their paths in your report.
- Check: no horizontal scroll, text contrast, focus ring visible when tabbing, wires and blocks aligned, nothing overlapping at 768 px.

## Commits for UI work

Same rules as `agent-brief.md`. Do not commit screenshots, build output (`dist/`) or logo files.

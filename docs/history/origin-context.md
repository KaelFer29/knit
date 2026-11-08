> **Historical document.** This is the original planning handoff (2026-11-08), kept for context. Much of it is outdated: the project is now called Knit, the spike was done and its risks were resolved, and the plan format changed. For the current state read [../status.md](../status.md).

# Orchestrator: project context

Handoff from a planning conversation held on 2026-11-08. Copy this file into `~/orchestrator/` (or `~/orquestador/`) and start a fresh Claude Code session there.

## Problem

The user develops personal projects in WSL Ubuntu 24.04 (`/home/kael/`) with Cursor ($20 plan) and Claude Code as a Cursor extension ($20 plan). Engram provides persistent memory between sessions.

Current roles:

- Claude Code: architect and planner.
- Cursor (models such as Grok or Composer): developer for fine-grained implementation.
- Engram: shared memory.
- The user: orchestrator.

The pain: the user acts as the message bus. They copy plans from one chat, paste them into several Cursor chats, collect results and bring them back. This is manual, slow and redundant.

Goal: an external orchestrator that runs on the user's machine, takes a plan, delegates each task to Cursor with a detailed prompt, verifies the result and shows progress on a custom web board. It must not depend on a Claude chat being open.

## Decisions

1. **The orchestrator is deterministic code, not an agent.** Intelligence lives in the agents. The orchestrator is a state machine: read plan, build prompt, run agent, run checks, record result, retry or escalate.
2. **Agents are workers invoked headless.**
   - Implementer: `cursor-agent -p` (Cursor CLI, print mode).
   - Planner and verifier: `claude -p` (Claude Code headless), only for phases that justify it.
3. **Hexagonal architecture.** A port `AgentRunner` with one adapter per CLI (Claude, Cursor). New agents plug in without touching the core.
4. **One git worktree per task**, so tasks are isolated and reviewable as diffs.
5. **Own web board**, not Vibe Kanban's UI. Backed by SQLite plus a live event stream (WebSocket or SSE).
6. **Phases are proportional, not mandatory.** Splitting every feature into explore, propose, spec, design, tasks, implement and verify burns tokens and quota on both $20 plans. Full phases only for large features. Small changes go planner then implementer.
7. **Lives in its own repository**, never inside another project.

## Target architecture

```
plan.md ──► orchestrator (state machine)
              ├─ claude -p        planner / verifier
              ├─ cursor-agent -p  implementer
              ├─ checks           lint, typecheck, tests of the target repo
              ├─ git worktree     one per task
              └─ SQLite + events ──► web board
```

## Ideas taken from Vibe Kanban

[Vibe Kanban](https://github.com/BloopAI/vibe-kanban) (BloopAI, open source) orchestrates coding agent CLIs, including Claude Code and Cursor CLI. Worth copying:

- Each card creates a git worktree and branch.
- The agent CLI runs inside that worktree with its output streamed live.
- A diff view to review the result, then merge or open a PR.

Not adopted: its UI. It can still be read as a reference implementation.

## Environment facts (verified 2026-11-08)

- Cursor IDE `3.27.14` on x64. This is the editor version, not the CLI version.
- `cursor-agent` is **not installed** in WSL. Official install:

  ```bash
  curl https://cursor.com/install -fsS | bash
  cursor-agent login
  ```

- Gentle AI (Agent Teams Lite with the ODD workflow) and Engram are installed for Claude Code.
- Engram scopes memories by project. A session in the orchestrator folder will not see memories saved under `pareja-app` unless asked explicitly.

## Risks to verify

- **Headless reliability of `cursor-agent -p`.** Older forum reports describe it hanging or not releasing the terminal. Their dates and whether they apply to the current CLI are unknown. This is the riskiest assumption: if it fails, the design changes.
- **Flags.** Third-party guides mention `--output-format json|stream-json`, `--force` (auto-approve tools) and `--trust`. Confirm against the official docs at `https://cursor.com/docs/cli/headless` before relying on them.
- **Write access.** In print mode the agent can edit files. Run it only inside the task worktree.
- **Quota.** Every `claude -p` call consumes the Claude plan limit. Every `cursor-agent -p` call consumes the Cursor plan. Measure cost per task during the spike.

## Next step: spike

Validate the riskiest assumption before writing the orchestrator.

1. Install `cursor-agent` and log in.
2. Create a throwaway git repository with a tiny task (for example, add a function and its test).
3. Run `cursor-agent -p` with JSON output on that task. Check that it returns, exits cleanly, edits the right files and that the output is parseable.
4. Record duration, exit code, output shape and any prompts that blocked it.
5. From the result, define the two contracts the orchestrator will automate:
   - The plan file format.
   - The prompt template sent to the implementer.

## Draft plan format (to refine during the spike)

```markdown
## T1: <short title>

Goal: <one sentence>
Specs:
- S1: <exact requirement, quoted from the user>
Allowed files:
- src/<path>
Checks:
- npm run lint
- npm test
```

## Open questions

- Orchestrator stack (TypeScript on Node is the natural fit for the board and CLI handling).
- How Engram fits: the agents keep using it as memory, the orchestrator may also record task results there.
- Retry policy: how many attempts before escalating a failed task to the user.

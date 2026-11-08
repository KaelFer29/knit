# Data model

Everything a run does is recorded, so a run can be inspected, resumed and, later, shown in a UI. Nothing is stored inside the target repository: data lives in `~/.knit` (or `--data-dir`, or `$KNIT_HOME`).

```
<data dir>/
  knit.db                              SQLite: runs, tasks, attempts, events, agent timeline
  worktrees/<run>/<task>/repo                  one git worktree per task (kept until `clean`)
  logs/<run>/<task>-attempt-<n>.jsonl          raw agent stream, one JSON object per line
```

## SQLite

Tables: `runs`, `tasks` (status, branch, worktree, start/commit SHA, PR URL), `attempts`, `events`, `agent_events`. The schema is versioned (`user_version`) and older databases are migrated in place. The file uses WAL mode, so another process can read it while a run writes.

**attempts**: `started_at`, `duration_ms`, `exit_code`, `is_error`, `input_tokens`, `output_tokens`, `scope_ok`, `failed_check`, `status`, `session_id`, `result_text`. `knit show <run-id>` prints the totals.

**events** (run lifecycle): `run.started|resumed|finished`, `task.started|reused|passed|failed`, `attempt.started|finished`, `check.started`, `push.finished|failed`, `pr.created|failed`, plus one compact `agent.tool_call` per tool the agent starts.

**agent_events** (what the agent did, normalized): `kind` is one of `system`, `prompt`, `thinking`, `message`, `tool_started`, `tool_completed`, `result`, `other`. Thinking deltas are coalesced into blocks; tool calls carry the tool name, arguments and result; strings longer than 4000 characters are clipped. Rows have an increasing `id`, so a reader can poll with `id > last_seen`. `knit logs <run-id> [--task T1] [--follow]` renders it.

## Raw transcripts

The `.jsonl` files keep every event exactly as the agent emitted it, with nothing clipped. Use them when the clipped timeline is not enough.

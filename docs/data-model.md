# Data model

Everything a run does is recorded, so a run can be inspected, resumed and, later, shown in a UI. Nothing is stored inside the target repository: data lives in `~/.knit` (or `--data-dir`, or `$KNIT_HOME`).

```
<data dir>/
  knit.db                              SQLite: runs, tasks, attempts, events, agent timeline
  worktrees/<run>/<task>/repo                  one git worktree per task (kept until `clean`)
  logs/<run>/<task>-attempt-<n>.jsonl          raw agent stream, one JSON object per line
```

## SQLite

Tables: `runs`, `tasks` (status, branch, worktree, start/commit SHA, PR URL), `attempts`, `events`, `agent_events`. The schema is versioned (`user_version`, now 4) and older databases are migrated in place. Columns added in version 4 are applied by checking the real columns rather than the version number, so an interrupted upgrade can simply be repeated. The file uses WAL mode, so another process can read it while a run writes.

**runs**: besides plan name, repo, base and status, `plan_text` keeps the plan file exactly as it was when the run started, and `pid` is the process executing the run. `pid` is set while the run is `running` and cleared when it finishes, so a `running` run whose process no longer exists crashed. Runs created before version 4 have neither.

**tasks**: `goal`, `depends_on`, `position` (1-based, which is also the execution order) and `specs` (JSON array of `{id, text}`) are copied from the plan when the task is created, so a run can be shown without re-reading the plan file. Tasks of older runs have none of them.

**attempts**: `started_at`, `duration_ms`, `exit_code`, `is_error`, `input_tokens`, `output_tokens`, `scope_ok`, `failed_check`, `status`, `session_id`, `result_text`. `knit show <run-id>` prints the totals.

**events** (run lifecycle): `run.started|resumed|finished`, `task.started|reused|passed|failed`, `attempt.started|finished`, `check.started`, `push.finished|failed`, `pr.created|failed`, plus one compact `agent.tool_call` per tool the agent starts.

**agent_events** (what the agent did, normalized): `agent` names the agent that produced the row (`cursor` or `claude`; every row from before version 4 is Cursor's). Claude's stream is normalized into the same kinds as Cursor's, so one timeline renders both: a `thinking` row from Claude has an empty `text` and `shared: false` when the agent did not share its reasoning, a `tool_completed` row names its tool and may carry `isError`, and a `result` row's usage is `inputTokens`, `outputTokens`, `cacheCreationTokens` and `cacheReadTokens`. No command writes `claude` rows yet; the Claude adapter is not wired into the CLI. `kind` is one of `system`, `prompt`, `thinking`, `message`, `tool_started`, `tool_completed`, `result`, `other`. Thinking deltas are coalesced into blocks; tool calls carry the tool name, arguments and result; strings longer than 4000 characters are clipped. Rows have an increasing `id`, so a reader can poll with `id > last_seen`. `knit logs <run-id> [--task T1] [--follow]` renders it.

## Raw transcripts

The `.jsonl` files keep every event exactly as the agent emitted it, with nothing clipped. Use them when the clipped timeline is not enough.

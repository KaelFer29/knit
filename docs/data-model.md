# Data model

Everything a run does is recorded, so a run can be inspected, resumed and, later, shown in a UI. Nothing is stored inside the target repository: data lives in `~/.knit` (or `--data-dir`, or `$KNIT_HOME`).

```
<data dir>/
  knit.db                              SQLite: runs, tasks, attempts, events, agent timeline, chat sessions
  worktrees/<run>/<task>/repo                  one git worktree per task (kept until `clean`)
  logs/<run>/<task>-attempt-<n>.jsonl          raw agent stream, one JSON object per line
```

## SQLite

Tables: `runs`, `tasks` (status, branch, worktree, start/commit SHA, PR URL), `attempts`, `events`, `agent_events`, and, for chat sessions, `sessions`, `turns`, `session_events`. The schema is versioned (`user_version`, now 5) and older databases are migrated in place. The schema and the migration live in one module (`adapters/storage/sqlite/schema.ts`) that every store opens the database through, so a new database gets the same tables and columns whichever store opens it first. The migration checks the real tables and columns rather than the version number, so an interrupted upgrade can simply be repeated, and it runs in one transaction that takes the write lock up front, so several processes opening the same old database at once all succeed. Existing rows are never rewritten: version 5 only adds tables. The file uses WAL mode, so another process can read it while a run writes.

**runs**: besides plan name, repo, base and status, `plan_text` keeps the plan file exactly as it was when the run started, and `pid` is the process executing the run. `pid` is set while the run is `running` and cleared when it finishes, so a `running` run whose process no longer exists crashed. Runs created before version 4 have neither.

**tasks**: `goal`, `depends_on`, `position` (1-based, which is also the execution order) and `specs` (JSON array of `{id, text}`) are copied from the plan when the task is created, so a run can be shown without re-reading the plan file. Tasks of older runs have none of them.

**attempts**: `started_at`, `duration_ms`, `exit_code`, `is_error`, `input_tokens`, `output_tokens`, `scope_ok`, `failed_check`, `status`, `session_id`, `result_text`. `knit show <run-id>` prints the totals.

**events** (run lifecycle): `run.started|resumed|finished`, `task.started|reused|passed|failed`, `attempt.started|finished`, `check.started`, `push.finished|failed`, `pr.created|failed`, plus one compact `agent.tool_call` per tool the agent starts.

**agent_events** (what the agent did, normalized): `agent` names the agent that produced the row (`cursor` or `claude`; every row from before version 4 is Cursor's). Claude's stream is normalized into the same kinds as Cursor's, so one timeline renders both: a `thinking` row from Claude has an empty `text` and `shared: false` when the agent did not share its reasoning, a `tool_completed` row names its tool and may carry `isError`, and a `result` row's usage is `inputTokens`, `outputTokens`, `cacheCreationTokens` and `cacheReadTokens`. No command writes `claude` rows yet; the Claude adapter is not wired into the CLI. `kind` is one of `system`, `prompt`, `thinking`, `message`, `tool_started`, `tool_completed`, `result`, `other`. Thinking deltas are coalesced into blocks; tool calls carry the tool name, arguments and result; strings longer than 4000 characters are clipped. Rows have an increasing `id`, so a reader can poll with `id > last_seen`. `knit logs <run-id> [--task T1] [--follow]` renders it.

## Chat sessions

A session is one conversation with one agent, started by `knit chat`. It is agent-agnostic: Claude and Cursor use the same tables, and `agent` says who owns the conversation. Version 5 added three tables; it did not touch `agent_events`, whose `run_id` is NOT NULL (SQLite cannot relax that without rebuilding the table), so a session's timeline has its own table with the same row shape.

**sessions**: `id` (Knit's own id, for example `chat-20261108-135523-a1b2c3`), `agent`, `agent_session_id` (the agent's own id for the conversation, empty until its first turn reports one, and what the next turn resumes), `title` (the first prompt, shortened), `cwd` (the directory the agent runs in, the same for every turn), `created_at`, `updated_at` (last time a turn started or finished; sessions are listed by it, newest first) and `status` (`running` while a turn is in flight, `idle` otherwise).

**turns**: one prompt and its answer. `session_id` and `seq` (1-based, unique within the session), `prompt`, `started_at`, `finished_at`, `status` (`running`, `passed`, `failed`), `result_text` (the agent's final answer), `input_tokens`, `output_tokens`, `exit_code` (empty when the process left none, for example after a timeout), `profile` (JSON of the knobs picked for the turn: `model`, `effort`, `permissionMode`), `meta` (JSON of what the agent reported during the turn: `commands`, its slash-command list; `planUsage`, the rate-limit windows with `name`, `utilization` from 0 to 1 and `resetsAt` in Unix seconds; and `model`) and `pid`. Like runs, `pid` is set while the turn runs and cleared when it ends, so a `running` turn whose process no longer exists crashed (a SIGKILLed process keeps its pid and `running` status).

**session_events**: the normalized timeline of a turn, with the same columns as `agent_events` except that `session_id` and `turn_id` replace `run_id`, `task_id` and `attempt`: `ts`, `kind`, `payload` and `agent` (not null). The kinds and payloads are the ones described for `agent_events`; ids increase, so a reader can poll with `id > last_seen`.

## Raw transcripts

The `.jsonl` files keep every event exactly as the agent emitted it, with nothing clipped. Use them when the clipped timeline is not enough.

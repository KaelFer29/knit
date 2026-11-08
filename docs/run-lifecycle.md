# Run lifecycle

What happens, in order, when a plan runs, and the rules Knit enforces. The plan syntax is in [plan-format.md](plan-format.md); the stored data is in [data-model.md](data-model.md).

## Division of work

| Who | Does |
| --- | --- |
| Knit | creates the worktree and the branch, runs setup, invokes the agent, verifies, retries, pushes, opens PRs, records everything |
| Agent (Cursor) | edits files and **commits its own work** on the branch it is given |
| Checks | the repository's own lint, typecheck and tests, defined in the plan |

Knit creates the branch (not the agent) because a worktree is bound to one branch from the moment it exists, and a wrong base would be silent. Push and PR stay with Knit so credentials never reach the agent.

## Implementer prompt

Rendered once per attempt and passed as the single prompt argument to `agent`. It contains the task, goal, specs verbatim and allowed files, plus these rules:

- Work only inside the current directory; do not write outside it; do not install dependencies unless a spec says so.
- Git: you are on branch `<branch>`, stay on it, do not switch/create/delete branches, do not push, do not amend/rebase/reset.
- Commit your work yourself, grouped by sub-functionality: one commit per cohesive piece, not one per file and not one for everything.
- Commit message `type(scope): description`: a single line, no body, no trailers; type in `feat, fix, refactor, docs, chore, test`; scope optional, lowercase letters and hyphens only; never `Co-authored-by`.
- Leave the working tree clean: everything committed.
- Reply in English with the files changed and the spec IDs covered.

On a retry the prompt adds what went wrong: the process failure, the scope violations, the git problems, or the failed check with the last 40 lines of its output.

## Invocation

```bash
cd <worktree> && agent -p --force --output-format stream-json "<prompt>" </dev/null
```

- Always `--force`: it also satisfies the workspace trust prompt a fresh worktree triggers (without it the CLI exits 1).
- stdin is closed; cwd is the worktree.
- The process runs in its own process group with a timeout (default 10 min per attempt); a timeout kills the whole group, and so does Ctrl-C on Knit.
- The stream's events (thinking, messages, tool calls with arguments and results, final result) are captured in full; see [data-model.md](data-model.md).

## Acceptance after each attempt

Knit, not the agent, decides:

1. **Process**: exit code 0, no timeout, a `result` event, `is_error` false.
2. **Scope**: every path that differs from the branch's start commit (committed, uncommitted, untracked) is inside `Allowed files`. Each worktree lives in a dedicated directory (`<data>/worktrees/<run>/<task>/repo`) and any new entry next to it counts as a violation (`../name`), because the agent can write outside its directory with `--force`.
3. **Git**: the worktree is still on the task branch; the start commit is still an ancestor of HEAD (no rewritten history); every commit since the start matches `type(scope): description` and has no body; nothing is left uncommitted.
4. **Changes**: at least one path changed. A task that changes nothing fails.
5. **Checks**: every command in `Checks` exits 0 (run only if 1-4 passed).

Any failure triggers a retry with feedback, up to `max_attempts` (default 2). After that the task is `failed`, later tasks are skipped and the run stops. The commit recorded for a passed task is the last commit of its branch.

## Delivery (opt-in)

Off by default. `--push` pushes each passed branch to `origin`. `--pr` also opens one pull request per task through `gh`:

- Title `type: <task title>` (type from the branch prefix); body lists goal, specs and checks.
- Independent task: PR targets the base branch (`Base:` or the repo's current branch; it must be a local branch). Dependent task: PR targets its parent's branch, so PRs stack.
- Before anything runs, `--pr` checks that `gh` is installed and logged in and that `origin` exists; otherwise it stops with a clear message and nothing is created.
- A push or PR failure does not fail the task (the work passed): it becomes a warning, recorded as an event and printed. `resume --pr` retries the missing delivery.
- Nothing is merged. Merging is a human decision.

## Resume and clean

- `resume <run-id>`: reads the plan from the path stored in the run. Tasks that passed are reused (not executed again). A failed task re-attaches to its kept worktree and the agent is told the previous run did not finish; if the worktree is gone, a fresh one is prepared. Attempt numbers continue.
- `clean <run-id>`: removes the run's worktrees. `--delete-branches` deletes only merged branches (`git branch -d`); unmerged work is never deleted. A run still marked as running needs `--force`.

## Abort

`abort <run-id> [--grace-seconds <n>] [--data-dir <dir>]` stops a run that is `running`, from any terminal (the web interface calls the same command). The run's process id is read from the database and checked before anything is signalled:

1. The run is not found: exit 1. It is not `running`: nothing to do, exit 0.
2. The pid is gone (crash, `kill -9`, reboot): the run is marked `failed`, its pid cleared and a `run.aborted` event recorded with reason `stale-pid`. Exit 0. Tasks keep the state they had; `resume` re-runs whatever did not pass.
3. The pid is alive but its command line is not a Knit `run` or a `resume` of this run id: the pid was reused by an unrelated process. **Nothing is signalled and nothing is changed**, exit 1. The same happens when two running runs record the same pid, or when a running run has no recorded pid (it predates schema 4).
4. Otherwise `SIGINT` is sent to that one process. The run's own handler kills the agent's process groups, marks the run `failed`, records `run.aborted` (no reason) and exits 130. Exit 0.
5. If the process is still alive after the grace period (default 10 s), the descendants' process groups are collected, then the run's process group (only when the run leads its own group, which is the case when the web interface started it) or just its pid, and every collected group, are sent `SIGKILL`. The run is marked `failed` with reason `killed-after-grace`. Exit 0, or 1 if the process survives `SIGKILL`.

A terminal-started run is not a group leader, so its group is never signalled: that group also holds the user's shell. Agents run in their own groups, which is why the escalation signals them explicitly.

## Open items

- Parallel tasks and multiple dependencies are out of scope: one task depends on at most one earlier task, and tasks run one at a time.
- A failed task stops the whole run, even if later tasks are independent.
- Token cost per attempt is still to be measured over real runs.
- The agent runs without a sandbox. Writes inside the worktree and next to it are detected; writes elsewhere on disk, and in files ignored by `.gitignore`, are not. `agent --sandbox enabled` was tried and did not stop writes outside the working directory.

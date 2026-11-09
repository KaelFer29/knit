import type { TaskView } from "@board";
import type { DetailSource, TimelineEntry } from "../detail/types";
import { formatDuration, formatTokens } from "../flow/format";
import { Disclosure } from "../molecules/Disclosure";
import { FileList } from "../molecules/FileList";
import { DiffView } from "../organisms/DiffView";
import { VerdictList } from "../organisms/KnitDetail";
import { TimelineList } from "../organisms/TimelineList";
import { shortModelId } from "../sessions/models";
import { Loaded } from "./Loaded";
import "../organisms/detail.css";

const LIVE_POLL_MS = 3000;

/** The model the agent reported in its session entry, when it did. */
function modelOf(entries: TimelineEntry[]): string | undefined {
  for (const entry of entries) {
    const payload = entry.payload;
    if (entry.kind === "system" && typeof payload === "object" && payload !== null && "model" in payload && typeof payload.model === "string" && payload.model !== "") return payload.model;
  }
  return undefined;
}

interface Props {
  task: TaskView;
  source: DetailSource;
}

/** An attempt the agent is still working on or Knit is still checking. */
const open = (status: string): boolean => status === "running" || status === "verifying";

/**
 * Detail of one task: its goal, each attempt (verdicts, and the agent timeline loaded when the attempt is opened) and
 * what it changed (the diff, loaded when opened).
 */
export function TaskDetail({ task, source }: Props) {
  const hasCode = task.startSha !== undefined;
  return (
    <div className="task-detail">
      {task.goal === undefined ? null : <p className="task-detail__goal">{task.goal}</p>}
      {task.attempts.length === 0 ? <p className="detail-note">No attempts yet.</p> : null}
      {task.attempts.map((attempt) => (
        <Disclosure
          key={attempt.attempt}
          defaultOpen={open(attempt.status)}
          title={
            <span className="task-detail__attempt-head">
              <span>{attempt.setup ? "Setup" : `Attempt ${attempt.attempt}`}</span>
              <span className="task-detail__status" data-status={attempt.status}>
                {attempt.status}
              </span>
            </span>
          }
          meta={[
            attempt.durationMs === undefined ? undefined : formatDuration(attempt.durationMs),
            attempt.outputTokens === undefined ? undefined : `${formatTokens((attempt.inputTokens ?? 0) + attempt.outputTokens)} tokens`,
            attempt.contextTokens === undefined ? undefined : `${formatTokens(attempt.contextTokens)} context`,
          ]
            .filter((x) => x !== undefined)
            .join(" · ")}
        >
          <VerdictList attempt={attempt} notes={source.attemptNotes(task.taskId, attempt.attempt)} />
          {attempt.setup ? null : (
            <>
              <p className="detail-label">Agent timeline</p>
              <Loaded load={() => source.timeline(task.taskId, attempt.attempt)} {...(open(attempt.status) ? { pollMs: LIVE_POLL_MS } : {})}>
                {(entries) => {
                  const model = modelOf(entries);
                  return (
                    <>
                      {model === undefined ? null : (
                        <p className="task-detail__model">
                          <span className="detail-label">Model</span> <code>{shortModelId(model)}</code>
                        </p>
                      )}
                      <TimelineList entries={entries} />
                    </>
                  );
                }}
              </Loaded>
              <p className="detail-label">Files touched</p>
              <Loaded load={() => source.activity(task.taskId, attempt.attempt)}>
                {(activity) => <FileList label="Files touched" paths={activity.touched} empty="This attempt touched no files." />}
              </Loaded>
            </>
          )}
        </Disclosure>
      ))}
      {hasCode ? (
        <Disclosure title="Changes" meta={task.commitSha === undefined ? "in progress" : undefined}>
          <Loaded load={() => source.diff(task.taskId)}>{(diff) => <DiffView diff={diff} />}</Loaded>
        </Disclosure>
      ) : null}
      {hasCode ? (
        <Disclosure title="Worktree changes">
          <Loaded load={() => source.activity(task.taskId)}>
            {(activity) => (
              <FileList
                label="Worktree changes"
                paths={activity.worktree?.paths ?? []}
                moreFiles={activity.worktree?.moreFiles ?? false}
                empty={activity.worktree === null ? "The worktree cannot be read." : "No uncommitted changes in the worktree."}
              />
            )}
          </Loaded>
        </Disclosure>
      ) : null}
    </div>
  );
}

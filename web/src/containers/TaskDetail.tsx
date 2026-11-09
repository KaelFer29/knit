import type { TaskView } from "@board";
import type { DetailSource } from "../detail/types";
import { formatDuration, formatTokens } from "../flow/format";
import { Disclosure } from "../molecules/Disclosure";
import { DiffView } from "../organisms/DiffView";
import { VerdictList } from "../organisms/KnitDetail";
import { TimelineList } from "../organisms/TimelineList";
import { Loaded } from "./Loaded";
import "../organisms/detail.css";

interface Props {
  task: TaskView;
  source: DetailSource;
}

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
          title={
            <span className="task-detail__attempt-head">
              <span>{attempt.setup ? "Setup" : `Attempt ${attempt.attempt}`}</span>
              <span className="task-detail__status" data-status={attempt.status}>
                {attempt.status}
              </span>
            </span>
          }
          meta={[attempt.durationMs === undefined ? undefined : formatDuration(attempt.durationMs), attempt.outputTokens === undefined ? undefined : `${formatTokens((attempt.inputTokens ?? 0) + attempt.outputTokens)} tokens`]
            .filter((x) => x !== undefined)
            .join(" · ")}
        >
          <VerdictList attempt={attempt} notes={source.attemptNotes(task.taskId, attempt.attempt)} />
          {attempt.setup ? null : (
            <>
              <p className="detail-label">Agent timeline</p>
              <Loaded load={() => source.timeline(task.taskId, attempt.attempt)}>{(entries) => <TimelineList entries={entries} />}</Loaded>
            </>
          )}
        </Disclosure>
      ))}
      {hasCode ? (
        <Disclosure title="Changes" meta={task.commitSha === undefined ? "in progress" : undefined}>
          <Loaded load={() => source.diff(task.taskId)}>{(diff) => <DiffView diff={diff} />}</Loaded>
        </Disclosure>
      ) : null}
    </div>
  );
}

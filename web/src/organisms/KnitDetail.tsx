import type { AttemptView, TaskView } from "@board";
import { retryFeedback, tail, verdictsOf } from "../detail/describe";
import type { AttemptNotes } from "../detail/types";
import { formatDuration } from "../flow/format";
import { Disclosure } from "../molecules/Disclosure";
import "./detail.css";

interface Props {
  tasks: TaskView[];
  notes: (taskId: string, attempt: number) => AttemptNotes;
}

export function VerdictList({ attempt, notes }: { attempt: AttemptView; notes: AttemptNotes }) {
  const verdicts = verdictsOf(attempt, notes);
  if (verdicts.length === 0) return <p className="detail-note">{attempt.status === "interrupted" ? "The run stopped during this attempt." : "The orchestrator has not judged this attempt yet."}</p>;
  return (
    <ul className="verdicts" aria-label="Orchestrator verdicts">
      {verdicts.map((v) => (
        <li key={v.label} className="verdicts__item" data-ok={v.ok ? "true" : "false"}>
          <span className="verdicts__mark" aria-hidden="true">
            {v.ok ? "✓" : "✕"}
          </span>
          <span className="verdicts__label">{v.label}</span>
          <span className="verdicts__state">{v.ok ? "passed" : "failed"}</span>
          {v.detail === undefined ? null : <code className="verdicts__detail">{v.detail}</code>}
        </li>
      ))}
    </ul>
  );
}

function AttemptBlock({ attempt, previous, notes }: { attempt: AttemptView; previous: AttemptView | undefined; notes: AttemptNotes & { previous: AttemptNotes } }) {
  const feedback = previous === undefined ? [] : retryFeedback(previous, notes.previous);
  return (
    <div className="knit-attempt">
      <p className="knit-attempt__head">
        <strong>{attempt.setup ? "Setup" : `Attempt ${attempt.attempt}`}</strong>
        {attempt.durationMs === undefined ? null : <span>{formatDuration(attempt.durationMs)}</span>}
      </p>
      {feedback.length === 0 ? null : (
        <div>
          <p className="detail-label">Feedback sent to the agent</p>
          <ul className="detail-list">
            {feedback.map((line) => (
              <li key={line}>
                <code>{line}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      <VerdictList attempt={attempt} notes={notes} />
      {notes.output === undefined || notes.output === "" ? null : (
        <div>
          <p className="detail-label">{attempt.setup ? "Setup output (last lines)" : "Agent's final answer (last lines)"}</p>
          <pre className="detail-pre">{tail(notes.output)}</pre>
        </div>
      )}
    </div>
  );
}

/** What Knit did for each task: setup, the verdict on every attempt and the feedback it gave for the next one. */
export function KnitDetail({ tasks, notes }: Props) {
  const started = tasks.filter((t) => t.attempts.length > 0);
  if (started.length === 0) return <p className="detail-note">The orchestrator has not started any task yet.</p>;
  return (
    <div className="knit-detail">
      {started.map((task) => (
        <Disclosure key={task.taskId} title={`${task.taskId} ${task.title}`} meta={task.attempts.length === 1 ? "1 attempt" : `${task.attempts.length} attempts`}>
          <div className="knit-detail__attempts">
            {task.attempts.map((attempt, i) => {
              const previous = i > 0 ? task.attempts[i - 1] : undefined;
              return (
                <AttemptBlock
                  key={attempt.attempt}
                  attempt={attempt}
                  previous={previous}
                  notes={{ ...notes(task.taskId, attempt.attempt), previous: previous ? notes(task.taskId, previous.attempt) : { gitProblems: [] } }}
                />
              );
            })}
          </div>
        </Disclosure>
      ))}
    </div>
  );
}

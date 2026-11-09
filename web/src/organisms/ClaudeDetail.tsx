import type { TaskView } from "@board";
import { Disclosure } from "../molecules/Disclosure";
import "./detail.css";

interface Props {
  planName: string;
  /** The plan as written; absent for runs recorded before the plan text was stored. */
  planText: string | undefined;
  tasks: TaskView[];
}

/** What Claude produced: the plan text and the specs of every task. The text renders as plain text, never as markup. */
export function ClaudeDetail({ planName, planText, tasks }: Props) {
  const withSpecs = tasks.filter((t) => t.specs.length > 0);
  return (
    <div className="claude-detail">
      <Disclosure title="Plan" meta={planName}>
        {planText === undefined ? <p className="detail-note">This run did not store the plan text.</p> : <pre className="detail-pre detail-pre--tall">{planText}</pre>}
      </Disclosure>
      <Disclosure title="Specs" meta={withSpecs.length === 0 ? "none" : `${withSpecs.length} ${withSpecs.length === 1 ? "task" : "tasks"}`}>
        {withSpecs.length === 0 ? (
          <p className="detail-note">No specs were recorded for this run.</p>
        ) : (
          withSpecs.map((task) => (
            <div key={task.taskId} className="claude-detail__task">
              <p className="detail-label">
                {task.taskId} {task.title}
              </p>
              {task.goal === undefined ? null : <p className="claude-detail__goal">{task.goal}</p>}
              <ul className="detail-list">
                {task.specs.map((spec) => (
                  <li key={spec.id}>
                    <code>{spec.id}</code> {spec.text}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </Disclosure>
    </div>
  );
}

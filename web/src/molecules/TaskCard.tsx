import type { TaskView } from "@board";
import { Chevron } from "../atoms/Chevron";
import { StatusBadge } from "../atoms/StatusBadge";
import type { RenderDetail } from "../flow/detail";
import { useDisclosure } from "../flow/useDisclosure";
import { DetailPanel } from "./DetailPanel";
import "./TaskCard.css";

/** What a card needs to know about a task. */
export type TaskCardData = Pick<TaskView, "taskId" | "title" | "position" | "state" | "dependsOn"> & {
  /** Agent attempts so far (the setup phase is not one). */
  attempts: number;
};

interface Props {
  task: TaskCardData;
  renderDetail?: RenderDetail | undefined;
}

/** A task as a card: position, title, state, attempts and its dependency. A disclosure widget with a detail slot. */
export function TaskCard({ task, renderDetail }: Props) {
  const { open, panelId, triggerProps } = useDisclosure();
  return (
    <div className="task-card" data-state={task.state}>
      <button className="task-card__trigger" {...triggerProps}>
        <span className="task-card__position">{task.position}</span>
        <span className="task-card__text">
          <span className="task-card__title">{task.title}</span>
          <span className="task-card__meta">
            <StatusBadge state={task.state} />
            {task.attempts > 0 ? <span className="task-card__attempts">{task.attempts === 1 ? "1 attempt" : `${task.attempts} attempts`}</span> : null}
            {task.dependsOn === undefined ? null : (
              <span className="task-card__dependency">
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                  <path d="M4 3v5a3 3 0 0 0 3 3h5m0 0-2.5-2.5M12 11l-2.5 2.5" />
                </svg>
                <span className="sr-only">Depends on </span>
                {task.dependsOn}
              </span>
            )}
          </span>
        </span>
        <Chevron />
      </button>
      {open ? (
        <DetailPanel id={panelId} label={`Detail of ${task.taskId}`}>
          {renderDetail?.({ kind: "task", taskId: task.taskId })}
        </DetailPanel>
      ) : null}
    </div>
  );
}

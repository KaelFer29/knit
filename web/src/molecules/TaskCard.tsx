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
  /** The state of the task's pull request, when it has one and GitHub could be asked. */
  pr?: { state: "open" | "merged" | "closed"; base: string; newCommits?: number } | undefined;
  renderDetail?: RenderDetail | undefined;
}

const PR_LABEL = { open: () => "PR open", closed: () => "PR closed", merged: (base: string) => `Merged into ${base}` } as const;

/** A task as a card: position, title, state, attempts and its dependency. A disclosure widget with a detail slot. */
export function TaskCard({ task, pr, renderDetail }: Props) {
  const { open, panelId, triggerProps } = useDisclosure();
  return (
    <div className="task-card" data-state={task.state}>
      <button className="task-card__trigger" {...triggerProps}>
        <span className="task-card__position">{task.position}</span>
        <span className="task-card__text">
          <span className="task-card__title">{task.title}</span>
          <span className="task-card__meta">
            <StatusBadge state={task.state} />
            {pr === undefined ? null : (
              <span className="task-card__pr" data-state={pr.state} title={pr.state === "merged" ? `The pull request of this task was merged into ${pr.base}.` : `The pull request of this task is ${pr.state}; it targets ${pr.base}.`}>
                {PR_LABEL[pr.state](pr.base)}
                {pr.state !== "open" && (pr.newCommits ?? 0) > 0 ? ` · ${pr.newCommits} new ${pr.newCommits === 1 ? "commit" : "commits"}` : ""}
              </span>
            )}
            {task.attempts > 0 ? (
              <span className="task-card__attempts" title="Times Cursor tried this task. A failed check sends it back for another attempt; the setup phase is not counted.">
                {task.attempts === 1 ? "1 attempt" : `${task.attempts} attempts`}
              </span>
            ) : null}
            {task.dependsOn === undefined ? null : (
              <span className="task-card__dependency" title={`Starts from the branch of ${task.dependsOn}, so its pull request goes into that branch.`}>
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

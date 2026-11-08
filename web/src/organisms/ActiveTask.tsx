import type { Ref } from "react";
import type { BoardModel, TaskView } from "@board";
import { Chevron } from "../atoms/Chevron";
import { StatusBadge } from "../atoms/StatusBadge";
import type { RenderDetail } from "../flow/detail";
import { useDisclosure } from "../flow/useDisclosure";
import { DetailPanel } from "../molecules/DetailPanel";
import "./Lane.css";
import "./ActiveTask.css";

type RunStatus = BoardModel["runStatus"];

interface Props {
  /** The task Knit has open, or the one that failed. */
  task?: TaskView | undefined;
  runStatus: RunStatus;
  renderDetail?: RenderDetail | undefined;
  /** The canvas measures this zone to leave the prompt wire from it and land the result on it. */
  ref?: Ref<HTMLElement>;
}

const IDLE_TEXT: Record<RunStatus, string> = {
  running: "Waiting for the next task.",
  passed: "All tasks delivered.",
  failed: "The run stopped.",
};

/** Knit's center: the task being worked on, where it is (agent or checks) and why it failed when it did. */
export function ActiveTask({ task, runStatus, renderDetail, ref }: Props) {
  return (
    <section className="lane active-task" aria-label="Running task" ref={ref}>
      <h3 className="lane__title">Now</h3>
      {task === undefined ? <p className="lane__empty">{IDLE_TEXT[runStatus]}</p> : <Focus task={task} renderDetail={renderDetail} />}
    </section>
  );
}

function Focus({ task, renderDetail }: { task: TaskView; renderDetail: RenderDetail | undefined }) {
  const { open, panelId, triggerProps } = useDisclosure();
  const openAttempt = task.attempts.find((a) => a.status === "running" || a.status === "verifying");
  const agentAttempts = task.attempts.filter((a) => !a.setup).length;
  const attempt = openAttempt ? (openAttempt.setup ? "Setting up" : `Attempt ${openAttempt.attempt}`) : agentAttempts > 0 ? (agentAttempts === 1 ? "1 attempt" : `${agentAttempts} attempts`) : undefined;
  const checking = task.state === "verifying" ? openAttempt?.checking : undefined;
  const working = task.state === "running" || task.state === "retrying" || task.state === "verifying";

  return (
    <div className="active-task__card" data-state={task.state}>
      <button className="active-task__trigger" {...triggerProps}>
        <span className="active-task__text">
          <span className="active-task__id">{task.taskId}</span>
          <span className="active-task__title">{task.title}</span>
          <span className="active-task__meta">
            <StatusBadge state={task.state} />
            {attempt === undefined ? null : <span>{attempt}</span>}
          </span>
        </span>
        <Chevron />
      </button>
      {working ? (
        <ol className="active-task__stages" aria-label="Stages">
          <li className="active-task__stage" data-done={task.state === "verifying" ? "true" : undefined} aria-current={task.state === "verifying" ? undefined : "step"}>
            Agent
          </li>
          <li className="active-task__stage" aria-current={task.state === "verifying" ? "step" : undefined}>
            Checks
          </li>
        </ol>
      ) : null}
      {checking === undefined ? null : (
        <p className="active-task__note">
          <span>Running</span> <code>{checking}</code>
        </p>
      )}
      {task.state === "failed" && task.failureReason !== undefined ? <p className="active-task__reason">{task.failureReason}</p> : null}
      {open ? (
        <DetailPanel id={panelId} label={`Detail of ${task.taskId}`}>
          {renderDetail?.({ kind: "task", taskId: task.taskId })}
        </DetailPanel>
      ) : null}
    </div>
  );
}

import { useState } from "react";
import "./RunControls.css";

interface Props {
  status: "running" | "passed" | "failed";
  /** Failed tasks, each of which can be retried. */
  failed: { taskId: string; title: string }[];
  busy: boolean;
  notice: { kind: "ok" | "error"; text: string } | undefined;
  onAbort: () => void;
  onResume: () => void;
  onRetry: (taskId: string) => void;
}

/** What can be done with this run right now: abort while it runs, resume or retry once it stopped on a failure. */
export function RunControls({ status, failed, busy, notice, onAbort, onResume, onRetry }: Props) {
  const [confirming, setConfirming] = useState(false);
  const canResume = status === "failed";
  if (status === "passed" && notice === undefined) return null;
  return (
    <section className="run-controls" aria-label="Run control">
      <div className="run-controls__actions">
        {status === "running" ? (
          confirming ? (
            <>
              <span className="run-controls__ask">Stop this run and its agent?</span>
              <button type="button" className="run-controls__button run-controls__button--danger" disabled={busy} onClick={() => { setConfirming(false); onAbort(); }}>
                Abort run
              </button>
              <button type="button" className="run-controls__button" onClick={() => setConfirming(false)}>
                Keep running
              </button>
            </>
          ) : (
            <button type="button" className="run-controls__button" disabled={busy} onClick={() => setConfirming(true)}>
              Abort
            </button>
          )
        ) : null}
        {canResume ? (
          <button type="button" className="run-controls__button" disabled={busy} onClick={onResume}>
            Resume
          </button>
        ) : null}
        {canResume
          ? failed.map((task) => (
              <button key={task.taskId} type="button" className="run-controls__button" disabled={busy} onClick={() => onRetry(task.taskId)} title={task.title}>
                Retry {task.taskId}
              </button>
            ))
          : null}
      </div>
      {notice === undefined ? null : (
        <p className={`run-controls__notice run-controls__notice--${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      )}
    </section>
  );
}

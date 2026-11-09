import { useState } from "react";
import type { BoardModel } from "@board";
import { abortRun, resumeRun, retryTask } from "../runs/api";
import type { Started } from "../runs/types";
import { RunControls } from "../organisms/RunControls";

type Notice = { kind: "ok" | "error"; text: string } | undefined;

/**
 * Container: sends the control commands of one run and says what happened. The board itself follows through the live
 * stream, so a command only needs to report that it was accepted (or why it was refused).
 */
export function RunControlBar({ board }: { board: BoardModel }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const send = async (send: () => Promise<Started>, done: string): Promise<void> => {
    setBusy(true);
    setNotice(undefined);
    try {
      await send();
      setNotice({ kind: "ok", text: done });
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "The command failed" });
    } finally {
      setBusy(false);
    }
  };
  const failed = board.tasks.filter((t) => t.state === "failed").map((t) => ({ taskId: t.taskId, title: t.title }));
  return (
    <RunControls
      status={board.runStatus}
      failed={failed}
      busy={busy}
      notice={notice}
      onAbort={() => void send(() => abortRun(board.runId), "Abort requested. The run stops in a moment.")}
      onResume={() => void send(() => resumeRun(board.runId), "Resumed.")}
      onRetry={(taskId) => void send(() => retryTask(board.runId, taskId), `Retrying ${taskId}.`)}
    />
  );
}

import { useId, useState } from "react";
import "./FollowupDraft.css";

interface Props {
  taskId: string;
  /** What Claude wrote for the follow-up; the person edits it before sending. */
  initial: string;
  /** Sends the instruction to the orchestrator; rejects with the reason when it was refused. */
  onSend: (text: string) => Promise<void>;
  onOpenCursor?: (() => void) | undefined;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * The instruction Claude wrote for a delivered task, in a box the person can edit, and the one click that sends it to
 * the orchestrator. Nothing is sent before that click. Once sent, Cursor continues its chat on the same branch and the
 * orchestrator verifies the result again like any attempt.
 */
export function FollowupDraft({ taskId, initial, onSend, onOpenCursor }: Props) {
  const [text, setText] = useState(initial);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string>();
  const id = useId();

  const send = async (): Promise<void> => {
    setState("sending");
    setError(undefined);
    try {
      await onSend(text.trim());
      setState("sent");
    } catch (err) {
      setError(messageOf(err));
      setState("idle");
    }
  };

  return (
    <section className="followup-draft" aria-label={`Follow-up for ${taskId}`}>
      <div className="followup-draft__head">
        <h3 className="followup-draft__heading">Follow-up for {taskId}</h3>
        {state === "sent" ? null : (
          <p className="followup-draft__note" id={`${id}-note`}>
            Claude wrote this. Edit it if you want, then send it.
          </p>
        )}
      </div>
      {state === "sent" ? (
        <p className="followup-draft__sent" role="status">
          Sent. Cursor is working on {taskId} in its own chat, on the same branch.
          {onOpenCursor === undefined ? null : (
            <>
              {" "}
              <button type="button" className="followup-draft__link" onClick={onOpenCursor}>
                Open Cursor
              </button>
            </>
          )}
        </p>
      ) : (
        <>
          <textarea className="followup-draft__text" aria-label="Follow-up instruction" aria-describedby={`${id}-note`} rows={3} value={text} disabled={state === "sending"} onChange={(e) => setText(e.target.value)} />
          {error === undefined ? null : (
            <p className="followup-draft__error" role="alert">
              {error}
            </p>
          )}
          <div className="followup-draft__foot">
            <button type="button" className="followup-draft__send" disabled={state === "sending" || text.trim() === ""} onClick={() => void send()}>
              {state === "sending" ? "Sending…" : "Send to the orchestrator"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

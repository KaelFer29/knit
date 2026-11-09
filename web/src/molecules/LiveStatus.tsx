import type { LiveBoard } from "../live/useBoard";
import "./LiveStatus.css";

const LABEL: Record<LiveBoard["connection"], string | undefined> = {
  idle: undefined,
  connecting: "Loading the run…",
  open: undefined,
  reconnecting: "Connection lost, reconnecting…",
  closed: undefined,
};

/** One quiet line about the live connection. Silent while everything works. */
export function LiveStatus({ connection, error }: Pick<LiveBoard, "connection" | "error">) {
  if (error !== undefined) {
    return (
      <p className="live-status live-status--error" role="alert">
        Could not load the run: {error}
      </p>
    );
  }
  const label = LABEL[connection];
  return label === undefined ? null : (
    <p className="live-status" role="status">
      {label}
    </p>
  );
}

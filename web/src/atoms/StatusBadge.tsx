import type { TaskState } from "@board";
import { TASK_STATE_LABEL } from "../flow/status";
import { StateIcon } from "./StateIcon";
import "../styles/states.css";
import "./StatusBadge.css";

interface Props {
  state: TaskState;
  /** Overrides the text, for blocks that borrow a task state's look (a block is "Done", a task "Delivered"). */
  label?: string;
}

/** A pill with the state's icon and its text label: color is never the only signal. */
export function StatusBadge({ state, label }: Props) {
  return (
    <span className="status-badge" data-state={state}>
      <StateIcon state={state} />
      <span className="status-badge__label">{label ?? TASK_STATE_LABEL[state]}</span>
    </span>
  );
}

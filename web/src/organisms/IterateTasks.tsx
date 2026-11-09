import type { IterationTarget } from "../sessions/iterate";
import "./IterateTasks.css";

interface Props {
  /** The delivered tasks of the run the page shows. */
  tasks: IterationTarget[];
  /** The task being iterated on, if any. */
  selected: string | undefined;
  /** Chooses a task; `undefined` when the chosen one is clicked again. */
  onSelect: (taskId: string | undefined) => void;
}

/**
 * The delivered tasks the person can keep working on, on their own branch and in their own Cursor chat. Choosing one
 * only marks it: what to change is written in the conversation, and Claude turns it into the instruction.
 */
export function IterateTasks({ tasks, selected, onSelect }: Props) {
  if (tasks.length === 0) return null;
  return (
    <ul className="iterate-tasks" aria-label="Tasks to iterate on">
      {tasks.map((task) => (
        <li key={task.taskId}>
          <button type="button" className="iterate-tasks__item" aria-pressed={selected === task.taskId} onClick={() => onSelect(selected === task.taskId ? undefined : task.taskId)}>
            <span className="iterate-tasks__id">{task.taskId}</span>
            <span className="iterate-tasks__title">{task.title}</span>
            {task.branch === undefined ? null : <span className="iterate-tasks__branch">{task.branch}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

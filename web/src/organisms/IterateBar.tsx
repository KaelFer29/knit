import { useId, useState } from "react";
import { Chevron } from "../atoms/Chevron";
import type { IterationTarget } from "../sessions/iterate";
import { IterateTasks } from "./IterateTasks";
import "./IterateBar.css";

interface Props {
  /** The delivered tasks of the run the page shows. */
  tasks: IterationTarget[];
  /** The task being iterated on, if any. */
  selected: string | undefined;
  onSelect: (taskId: string | undefined) => void;
}

/**
 * The small bar above the composer that turns the next prompts into corrections of a delivered task. Closed, it says
 * what it does; open, it lists the tasks; with one chosen, it says which and that its corrections go to the
 * orchestrator, with a way to stop. Choosing a task closes the list.
 */
export function IterateBar({ tasks, selected, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const target = tasks.find((t) => t.taskId === selected);
  if (tasks.length === 0) return null;
  return (
    <section className="iterate-bar" aria-label="Task iteration" data-open={open || undefined} data-selected={target !== undefined || undefined}>
      <div className="iterate-bar__row">
        <button type="button" className="iterate-bar__toggle" aria-label="Iterate on a task" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen((v) => !v)}>
          <span className="iterate-bar__icon" aria-hidden="true">
            {target === undefined ? (
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" focusable="false">
                <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.8h-2.8" />
              </svg>
            ) : (
              <span className="iterate-bar__pulse" />
            )}
          </span>
          {target === undefined ? (
            <>
              <span className="iterate-bar__title">Iterate on a task</span>
              <span className="iterate-bar__count">{tasks.length}</span>
              <span className="iterate-bar__hint">Correct a task in its own Cursor chat</span>
            </>
          ) : (
            <>
              <span className="iterate-bar__title">Next correction for {target.taskId}</span>
              {target.branch === undefined ? null : <span className="iterate-bar__branch">{target.branch}</span>}
              <span className="iterate-bar__dest">
                <span aria-hidden="true">→</span> sent to the orchestrator only when you press Send
              </span>
            </>
          )}
          <Chevron />
        </button>
        {target === undefined ? null : (
          <button type="button" className="iterate-bar__stop" aria-label="Stop iterating" title="Stop iterating" onClick={() => onSelect(undefined)}>
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        )}
      </div>
      {open ? (
        <div className="iterate-bar__panel" id={listId}>
          <IterateTasks
            tasks={tasks}
            selected={selected}
            onSelect={(id) => {
              onSelect(id);
              if (id !== undefined) setOpen(false);
            }}
          />
        </div>
      ) : null}
    </section>
  );
}

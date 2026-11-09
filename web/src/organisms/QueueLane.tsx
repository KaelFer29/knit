import { Fragment, useState, type Ref } from "react";
import type { RenderDetail } from "../flow/detail";
import { TaskCard, type TaskCardData } from "../molecules/TaskCard";
import "./Lane.css";
import "./QueueLane.css";

interface Props {
  /** Queued tasks in execution order. */
  items: readonly TaskCardData[];
  renderDetail?: RenderDetail | undefined;
  /** Cards shown before the rest fold behind a button. */
  limit?: number;
  /** The canvas measures this zone to land the plan wires on it. */
  ref?: Ref<HTMLElement>;
}

/** Pending tasks as stacked cards in execution order, with a connector where a task waits for its neighbour. */
export function QueueLane({ items, renderDetail, limit = 6, ref }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hidden = Math.max(0, items.length - limit);
  const visible = expanded ? items : items.slice(0, limit);

  return (
    <section className="lane queue-lane" aria-label="Queue" ref={ref}>
      <h3 className="lane__title">
        Queue <span className="lane__count">{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p className="lane__empty">Nothing waiting.</p>
      ) : (
        <ol className="queue-lane__list">
          {visible.map((task, i) => {
            const previous = visible[i - 1];
            return (
              <Fragment key={task.taskId}>
                {previous !== undefined && task.dependsOn === previous.taskId ? <li className="queue-lane__connector" data-connector aria-hidden="true" /> : null}
                <li className="queue-lane__item">
                  <TaskCard task={task} renderDetail={renderDetail} />
                </li>
              </Fragment>
            );
          })}
        </ol>
      )}
      {hidden > 0 ? (
        <button className="lane__more" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show fewer" : `Show ${hidden} more`}
        </button>
      ) : null}
    </section>
  );
}

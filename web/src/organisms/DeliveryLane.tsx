import type { DeliveryItem } from "@board";
import { prLabel, safeHttpUrl, shortSha } from "../flow/format";
import "./Lane.css";
import "./DeliveryLane.css";

interface Props {
  /** Delivered tasks in execution order. */
  items: readonly DeliveryItem[];
}

const iconProps = { viewBox: "0 0 16 16", width: 12, height: 12, fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false } as const;

/** Knit's output: one commit chip and one pull request chip per delivered task, as a chain. */
export function DeliveryLane({ items }: Props) {
  return (
    <section className="lane delivery-lane" aria-label="Delivered tasks">
      <h3 className="lane__title">
        Delivered <span className="lane__count">{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p className="lane__empty">Delivered tasks will appear here.</p>
      ) : (
        <ol className="delivery-lane__list">
          {items.map((item) => {
            const url = safeHttpUrl(item.prUrl);
            return (
              <li className="delivery-lane__item" key={item.taskId} title={item.title}>
                <span className="delivery-lane__task">{item.taskId}</span>
                {item.commitSha === undefined ? null : (
                  <span className="chip chip--commit" title={item.commitSha}>
                    <svg {...iconProps}>
                      <circle cx="8" cy="8" r="2.4" />
                      <path d="M1.5 8h4.1M10.4 8h4.1" />
                    </svg>
                    {shortSha(item.commitSha)}
                  </span>
                )}
                {url === undefined ? null : (
                  <a className="chip chip--pr" href={url} target="_blank" rel="noopener noreferrer">
                    {prLabel(url)}
                    <svg {...iconProps}>
                      <path d="M6 3.5H3.5v9h9V10M9 3.5h3.5V7M12.5 3.5 7 9" />
                    </svg>
                  </a>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

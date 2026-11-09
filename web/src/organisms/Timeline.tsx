import { useEffect, useRef } from "react";
import { TimelineEntry } from "../molecules/TimelineEntry";
import type { TimelineItem } from "../sessions/timeline";
import "./Timeline.css";

const NEAR_BOTTOM_PX = 80;

/** The live conversation. It follows new entries while the reader is at the bottom and stays put once they scroll up. */
export function Timeline({ items, emptyText }: { items: TimelineItem[]; emptyText: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  return (
    <div
      ref={ref}
      className="chat-timeline"
      tabIndex={0}
      role="log"
      aria-label="Conversation"
      aria-live="polite"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
      }}
    >
      {items.length === 0 ? <p className="chat-timeline__empty">{emptyText}</p> : items.map((item) => <TimelineEntry key={item.key} item={item} />)}
    </div>
  );
}

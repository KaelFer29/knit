import type { TaskState } from "@board";

/**
 * One icon per task state. The shapes differ (dashed ring, arc, arrow, checklist, check, cross), so a state
 * is readable without its color. Decorative: the text label next to it carries the meaning.
 */
export function StateIcon({ state }: { state: TaskState }) {
  return (
    <svg className="state-icon" data-icon={state} viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {shape(state)}
    </svg>
  );
}

function shape(state: TaskState) {
  switch (state) {
    case "queued":
      return <circle cx="8" cy="8" r="5.4" strokeDasharray="2.4 2.6" />;
    case "running":
      return (
        <>
          <circle cx="8" cy="8" r="5.4" opacity="0.25" />
          <path className="state-icon__spin" d="M8 2.6a5.4 5.4 0 0 1 5.4 5.4" />
        </>
      );
    case "retrying":
      return (
        <>
          <path d="M13.2 8a5.2 5.2 0 1 1-1.7-3.85" />
          <path d="M13.4 2.6v3h-3" />
        </>
      );
    case "verifying":
      return (
        <>
          <path d="M2.8 4.4h5.4M2.8 8h3.4M2.8 11.6h2.4" />
          <path d="m8.6 10.6 1.9 1.9 3.5-3.9" />
        </>
      );
    case "delivered":
      return (
        <>
          <circle cx="8" cy="8" r="6.2" fill="currentColor" stroke="none" />
          <path className="state-icon__on-fill" d="m5.2 8.2 1.9 1.9 3.7-4" />
        </>
      );
    case "failed":
      return (
        <>
          <circle cx="8" cy="8" r="6.2" fill="currentColor" stroke="none" />
          <path className="state-icon__on-fill" d="m5.8 5.8 4.4 4.4m0-4.4-4.4 4.4" />
        </>
      );
  }
}

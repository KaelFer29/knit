import "./Chevron.css";

/** The caret of a disclosure widget. It turns when the widget's trigger is `aria-expanded="true"`. */
export function Chevron() {
  return (
    <svg className="chevron" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
    </svg>
  );
}

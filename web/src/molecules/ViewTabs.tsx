import type { View } from "../nav/useView";
import "./ViewTabs.css";

const VIEWS: { view: View; label: string }[] = [
  { view: "flow", label: "Flow" },
  { view: "config", label: "Configuration" },
];

/** Switches between the app's views. Buttons with `aria-current`, so Tab and Enter work with no extra keyboard code. */
export function ViewTabs({ value, onChange }: { value: View; onChange: (view: View) => void }) {
  return (
    <nav className="view-tabs" aria-label="Views">
      {VIEWS.map(({ view, label }) => (
        <button key={view} type="button" className="view-tabs__tab" aria-current={view === value ? "page" : undefined} onClick={() => onChange(view)}>
          {label}
        </button>
      ))}
    </nav>
  );
}

import "./RouteSwitch.css";

interface Props {
  on: boolean;
  onChange: (on: boolean) => void;
}

/**
 * The switch that sends the next prompt to the orchestrator instead of just chatting: the agent drafts a plan, the
 * person confirms it. A native button with `role="switch"`, so it is keyboard and screen-reader friendly.
 */
export function RouteSwitch({ on, onChange }: Props) {
  return (
    <div className="route" data-on={on}>
      <button type="button" role="switch" aria-checked={on} className="route__switch" onClick={() => onChange(!on)}>
        <span className="route__track" aria-hidden="true">
          <span className="route__thumb" />
        </span>
        <span className="route__label">Send to the orchestrator</span>
      </button>
    </div>
  );
}

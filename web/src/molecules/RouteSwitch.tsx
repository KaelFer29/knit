import "./RouteSwitch.css";

interface Props {
  on: boolean;
  onChange: (on: boolean) => void;
  /** Off and unusable, for example while the prompt already goes to the orchestrator another way. */
  disabled?: boolean | undefined;
  /** Why it is disabled, shown when the pointer rests on it. */
  reason?: string | undefined;
}

/**
 * The switch that sends the next prompt to the orchestrator instead of just chatting: the agent drafts a plan, the
 * person confirms it. A native button with `role="switch"`, so it is keyboard and screen-reader friendly.
 */
export function RouteSwitch({ on, onChange, disabled = false, reason }: Props) {
  return (
    <div className="route" data-on={on} data-disabled={disabled || undefined}>
      <button type="button" role="switch" aria-checked={on} className="route__switch" disabled={disabled} title={disabled ? reason : undefined} onClick={() => onChange(!on)}>
        <span className="route__track" aria-hidden="true">
          <span className="route__thumb" />
        </span>
        <span className="route__label">Send to the orchestrator</span>
      </button>
    </div>
  );
}

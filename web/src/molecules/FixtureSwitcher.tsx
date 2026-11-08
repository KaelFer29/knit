import type { FixtureName } from "../flow/params";
import "./FixtureSwitcher.css";

const LABEL: Record<FixtureName, string> = {
  runningRun: "Running",
  retryingRun: "Retrying",
  verifyingRun: "Verifying",
  failedRun: "Failed",
  deliveredRun: "Delivered",
  longQueueRun: "Long queue",
  legacyRun: "Before schema 4",
};

const href = (fixture: FixtureName, demo: boolean) => `?fixture=${fixture}${demo ? "&demo=1" : ""}`;

interface Props {
  current: FixtureName;
  demo: boolean;
}

/** A development aid, shown only when the URL asks for a fixture: pick a sample run, and turn the demo pulses on or off. */
export function FixtureSwitcher({ current, demo }: Props) {
  return (
    <div className="fixture-switcher">
      <nav className="fixture-switcher__nav" aria-label="Fixtures">
        {(Object.keys(LABEL) as FixtureName[]).map((name) => (
          <a key={name} className="fixture-switcher__link" href={href(name, demo)} aria-current={name === current ? "page" : undefined}>
            {LABEL[name]}
          </a>
        ))}
      </nav>
      <a className="fixture-switcher__demo" href={href(current, !demo)} data-on={demo ? "true" : undefined}>
        Demo pulses: {demo ? "on" : "off"}
      </a>
    </div>
  );
}

import { runsHash } from "../route";
import type { RunListItem } from "../runs/types";
import "./RunPicker.css";

interface Props {
  current: string;
  runs: RunListItem[] | undefined;
}

/** Back to the list and a native select to jump to another run: keyboard and screen reader friendly for free. */
export function RunPicker({ current, runs }: Props) {
  const list = runs ?? [];
  return (
    <div className="run-picker">
      <a className="run-picker__back" href={runsHash()}>
        ← All runs
      </a>
      {list.length > 1 ? (
        <label className="run-picker__label">
          <span className="run-picker__text">Switch run</span>
          <select
            className="run-picker__select"
            value={current}
            onChange={(e) => {
              window.location.hash = runsHash(e.target.value);
            }}
          >
            {list.some((r) => r.run.id === current) ? null : <option value={current}>{current}</option>}
            {list.map((r) => (
              <option key={r.run.id} value={r.run.id}>
                {r.run.planName} · {r.run.id}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

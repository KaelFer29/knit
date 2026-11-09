import { useState, type FormEvent } from "react";
import type { StartOptions } from "../runs/types";
import "./StartRunForm.css";

interface Props {
  busy: boolean;
  error: string | undefined;
  onStart: (options: StartOptions) => void;
}

/** Starts a run from a plan file on the machine running `knit ui`. The server checks the path and the plan. */
export function StartRunForm({ busy, error, onStart }: Props) {
  const [planPath, setPlanPath] = useState("");
  const [push, setPush] = useState(false);
  const [pr, setPr] = useState(false);
  const [attempts, setAttempts] = useState("");
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const n = attempts.trim() === "" ? undefined : Number(attempts);
    onStart({ planPath: planPath.trim(), push, pr, ...(n === undefined ? {} : { maxAttempts: n }) });
  };
  return (
    <form className="start-run" onSubmit={submit} aria-label="Start a run">
      <label className="start-run__field start-run__path">
        <span>Plan file (absolute path)</span>
        <input value={planPath} onChange={(e) => setPlanPath(e.target.value)} placeholder="/home/you/project/plan.md" spellCheck={false} autoComplete="off" />
      </label>
      <label className="start-run__field start-run__attempts">
        <span>Max attempts</span>
        <input type="number" min={1} max={20} value={attempts} onChange={(e) => setAttempts(e.target.value)} placeholder="default" />
      </label>
      <label className="start-run__check">
        <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} /> Push
      </label>
      <label className="start-run__check">
        <input type="checkbox" checked={pr} onChange={(e) => setPr(e.target.checked)} /> Open PRs
      </label>
      <button type="submit" className="start-run__submit" disabled={busy || planPath.trim() === ""}>
        {busy ? "Starting…" : "Start run"}
      </button>
      {error === undefined ? null : (
        <p className="start-run__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

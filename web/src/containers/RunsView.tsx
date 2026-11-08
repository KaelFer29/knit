import { useState } from "react";
import { RunsList } from "../organisms/RunsList";
import { StartRunForm } from "../organisms/StartRunForm";
import { runsHash } from "../route";
import { startRun } from "../runs/api";
import type { StartOptions } from "../runs/types";
import { useRuns } from "../runs/useRuns";
import "./RunsView.css";

/** Container: the runs list with the form that starts a new one. A started run opens on the canvas. */
export function RunsView({ pollMs }: { pollMs?: number }) {
  const { runs, error, reload } = useRuns(pollMs);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string>();
  const start = async (options: StartOptions): Promise<void> => {
    setBusy(true);
    setStartError(undefined);
    try {
      const started = await startRun(options);
      window.location.hash = runsHash(started.runId);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Could not start the run");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="runs-view" aria-labelledby="runs-title">
      <h1 id="runs-title" className="runs-view__title">
        Runs
      </h1>
      <StartRunForm busy={busy} error={startError} onStart={(o) => void start(o)} />
      <RunsList runs={runs} error={error} onRetry={reload} />
    </section>
  );
}

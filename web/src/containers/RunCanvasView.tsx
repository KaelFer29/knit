import { RunPicker } from "../molecules/RunPicker";
import { useRuns } from "../runs/useRuns";
import { FlowView } from "./FlowView";

/** Container: one run on the canvas, with the way back to the list and to another run. */
export function RunCanvasView({ runId }: { runId: string }) {
  const { runs } = useRuns();
  return (
    <>
      <RunPicker current={runId} runs={runs} />
      <FlowView key={runId} runId={runId} />
    </>
  );
}

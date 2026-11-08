import { RunControlBar } from "../../../containers/RunControlBar";
import { RunsView } from "../../../containers/RunsView";
import type { PanelProps } from "../registry";

/** Knit's panel body. For now the runs list with the run control; task U4 replaces it. */
export function KnitPanel({ board, live }: PanelProps) {
  return (
    <>
      {board !== undefined && live ? <RunControlBar board={board} /> : null}
      <RunsView />
    </>
  );
}

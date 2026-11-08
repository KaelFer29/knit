import { ALL_FIXTURES } from "../fixtures/boards";
import { parseFlowParams } from "../flow/params";
import { useDemoPulses } from "../flow/useDemoPulses";
import { FixtureSwitcher } from "../molecules/FixtureSwitcher";
import { RunHeader } from "../molecules/RunHeader";
import { FlowCanvas } from "../organisms/FlowCanvas";

interface Props {
  /** The URL query string. Defaults to the page's own. */
  search?: string;
}

/**
 * Container: decides which board the canvas draws and which pulses it plays, and hands them down.
 * Today the board is a fixture chosen with `?fixture=<name>` and the pulses come from the demo mode
 * (`?demo=1`). The live data source replaces `ALL_FIXTURES[...]` and `useDemoPulses` here; nothing below changes.
 */
export function FlowView({ search = window.location.search }: Props) {
  const params = parseFlowParams(search);
  const board = ALL_FIXTURES[params.fixture];
  const { pulses, onPulseEnd } = useDemoPulses(board, params.demo);
  return (
    <>
      {params.switcher ? <FixtureSwitcher current={params.fixture} demo={params.demo} /> : null}
      <RunHeader board={board} />
      <FlowCanvas board={board} pulses={pulses} onPulseEnd={onPulseEnd} />
    </>
  );
}

import { useMemo } from "react";
import { ALL_FIXTURES } from "../fixtures/boards";
import { fixtureDetailSource } from "../fixtures/detail";
import { createRenderDetail } from "./detailRenderer";
import { parseFlowParams } from "../flow/params";
import { useDemoPulses } from "../flow/useDemoPulses";
import { createApiDetailSource } from "../detail/apiSource";
import { useBoard } from "../live/useBoard";
import { LiveStatus } from "../molecules/LiveStatus";
import { FixtureSwitcher } from "../molecules/FixtureSwitcher";
import { RunHeader } from "../molecules/RunHeader";
import { FlowCanvas } from "../organisms/FlowCanvas";

interface Props {
  /** The URL query string. Defaults to the page's own. */
  search?: string;
}

/**
 * Container: decides which board the canvas draws and which pulses it plays, and hands them down.
 * With `?run=<id>` the board is that run's, kept current from the live stream, and the pulses come from its events.
 * Without it the board is a fixture chosen with `?fixture=<name>` and the pulses come from the demo mode (`?demo=1`).
 */
export function FlowView({ search = window.location.search }: Props) {
  const params = parseFlowParams(search);
  const live = useBoard(params.run);
  const fixture = ALL_FIXTURES[params.fixture];
  const board = params.run === undefined ? fixture : live.board;
  const demo = useDemoPulses(fixture, params.run === undefined && params.demo);
  const { pulses, onPulseEnd } = params.run === undefined ? demo : live;
  const renderDetail = useMemo(() => {
    if (board === undefined) return undefined;
    if (params.run === undefined) return createRenderDetail(board, fixtureDetailSource(board));
    return live.snapshot ? createRenderDetail(board, createApiDetailSource(live.snapshot)) : undefined;
  }, [board, params.run, live.snapshot]);
  return (
    <>
      {params.switcher ? <FixtureSwitcher current={params.fixture} demo={params.demo} /> : null}
      {params.run !== undefined ? <LiveStatus connection={live.connection} error={live.error} /> : null}
      {board === undefined ? null : (
        <>
          <RunHeader board={board} />
          <FlowCanvas board={board} pulses={pulses} onPulseEnd={onPulseEnd} {...(renderDetail ? { renderDetail } : {})} />
        </>
      )}
    </>
  );
}

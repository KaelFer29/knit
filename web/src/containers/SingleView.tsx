import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ALL_FIXTURES } from "../fixtures/boards";
import { fixtureDetailSource } from "../fixtures/detail";
import { createApiDetailSource } from "../detail/apiSource";
import { parseFlowParams } from "../flow/params";
import { AGENTS, AGENT_ORDER, type AgentId } from "../identity/agents";
import { useBoard } from "../live/useBoard";
import { LiveStatus } from "../molecules/LiveStatus";
import { AppShell } from "../organisms/AppShell";
import { PipelineStage } from "../organisms/PipelineStage";
import { PanelModal } from "../organisms/PanelModal";
import { runsHash, useRoute } from "../route";
import { useRuns } from "../runs/useRuns";
import { deriveBlocks, deriveDetails, deriveHops, deriveStages } from "../single/pipeline";
import { PANELS, type PanelId } from "../single/panels/registry";
import { useWorkspace } from "../sessions/useWorkspace";
import { useLatestSession } from "../single/useLatestSession";
import { createRenderDetail } from "./detailRenderer";
import "./SingleView.css";

interface Props {
  /** The URL query string. Defaults to the page's own. */
  search?: string;
  /** Controls next to the configuration button in the header . */
  actions?: ReactNode;
}

/**
 * Container: the one view of the app. It picks the run to show (`#/runs/<id>` or `?run=<id>`, else the most recent
 * run; `?fixture=` and `?demo=1` show a built-in sample), follows it live, derives the blocks and the pipeline from
 * it and from the latest Claude session, and opens the modal the person asks for.
 */
export function SingleView({ search = window.location.search, actions }: Props) {
  const params = parseFlowParams(search);
  const query = new URLSearchParams(search);
  const fixtureMode = params.run === undefined && (query.has("fixture") || query.has("demo"));
  const route = useRoute();
  const { runs } = useRuns();
  const recent = useMemo(() => (runs === undefined ? undefined : [...runs].sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt))[0]?.run.id), [runs]);
  const runId = route.runId ?? params.run ?? (fixtureMode ? undefined : recent);

  const live = useBoard(runId);
  const board = runId === undefined ? (fixtureMode ? ALL_FIXTURES[params.fixture] : undefined) : live.board;
  const workspace = useWorkspace(!fixtureMode);
  const session = useLatestSession(!fixtureMode || runId !== undefined);
  const renderDetail = useMemo(() => {
    if (board === undefined) return undefined;
    if (runId === undefined) return createRenderDetail(board, fixtureDetailSource(board));
    return live.snapshot ? createRenderDetail(board, createApiDetailSource(live.snapshot)) : undefined;
  }, [board, runId, live.snapshot]);

  const blocks = useMemo(() => deriveBlocks(board, session), [board, session]);
  const hops = useMemo(() => deriveHops(board, session), [board, session]);
  const stages = useMemo(() => deriveStages(board), [board]);
  const details = useMemo(() => deriveDetails(board, session), [board, session]);

  const [open, setOpen] = useState<PanelId>();
  const toggle = useCallback((id: PanelId) => setOpen((current) => (current === id ? undefined : id)), []);
  const selectRun = useCallback((id: string | undefined) => {
    window.location.hash = id === undefined ? "" : runsHash(id);
  }, []);

  const Panel = open === undefined ? undefined : PANELS[open];
  const configButton = (
    <button type="button" className="single__config" data-panel-trigger="config" aria-haspopup="dialog" aria-expanded={open === "config"} onClick={() => toggle("config")}>
      Configuration
    </button>
  );

  return (
    <AppShell label="Knit pipeline" workspace={workspace} actions={<>{configButton}{actions}</>}>
      <div className="single">
        <section className="single__stage" aria-label="Claude, orchestrator and Cursor pipeline">
          {runId !== undefined ? <LiveStatus connection={live.connection} error={live.error} /> : null}
          <PipelineStage blocks={blocks} details={details} hops={hops} stages={stages} openId={open !== undefined && (AGENT_ORDER as readonly string[]).includes(open) ? (open as AgentId) : undefined} onOpen={toggle} />
        </section>
        {Panel === undefined || open === undefined ? null : (
          <PanelModal key={open} panelId={open} title={Panel.title} identity={(AGENT_ORDER as readonly string[]).includes(open) ? AGENTS[open as AgentId] : undefined} onClose={() => setOpen(undefined)}>
            <Panel.Component board={board} runId={runId} live={runId !== undefined} renderDetail={renderDetail} selectRun={selectRun} agentId={open} />
          </PanelModal>
        )}
      </div>
    </AppShell>
  );
}

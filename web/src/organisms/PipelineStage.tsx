import { BlockCard } from "../molecules/BlockCard";
import { PipelineHop } from "../molecules/PipelineHop";
import { AGENTS, AGENT_ORDER, type AgentId } from "../identity/agents";
import type { BlockDetails, BlockView, HopView, StageView } from "../single/pipeline";
import "./PipelineStage.css";

interface Props {
  blocks: Record<AgentId, BlockView>;
  details: Record<AgentId, BlockDetails>;
  hops: HopView[];
  /** The orchestrator's own stages, drawn inside its block. */
  stages: StageView[];
  /** The block whose side panel is open, if any. */
  openId?: AgentId | undefined;
  onOpen: (id: AgentId) => void;
}

/**
 * The whole product on one screen: Claude, the orchestrator and Cursor joined by the pipeline. Claude's plan goes to the
 * orchestrator, its prompt goes to Cursor and Cursor's result comes back to it. Wide containers lay it out left to right; narrow ones
 * (a side panel is open, or a small window) stack it top to bottom.
 */
export function PipelineStage({ blocks, details, hops, stages, openId, onOpen }: Props) {
  const hop = (id: HopView["id"]) => hops.find((h) => h.id === id);
  const plan = hop("plan");
  const prompt = hop("prompt");
  const result = hop("result");
  return (
    <div className="pipeline">
      <div className="pipeline__grid">
        {AGENT_ORDER.map((id) => (
          <div key={id} className="pipeline__cell" data-area={id}>
            <BlockCard identity={AGENTS[id]} view={blocks[id]} details={details[id]} {...(AGENTS[id].skin === "pipeline" ? { stages } : {})} open={openId === id} onOpen={() => onOpen(id)} />
          </div>
        ))}
        {plan ? (
          <div className="pipeline__cell" data-area="plan">
            <PipelineHop hop={plan} />
          </div>
        ) : null}
        {prompt ? (
          <div className="pipeline__cell" data-area="prompt">
            <PipelineHop hop={prompt} />
          </div>
        ) : null}
        {result ? (
          <div className="pipeline__cell" data-area="result">
            <PipelineHop hop={result} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

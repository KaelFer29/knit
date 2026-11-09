import { createRef, useMemo, useState, type ReactNode } from "react";
import type { BoardModel, NodeStatus, WireId } from "@board";
import { StateIcon } from "../atoms/StateIcon";
import type { RenderDetail } from "../flow/detail";
import { computeWires } from "../flow/geometry";
import type { Pulse } from "../flow/pulses";
import { boardStrands } from "../flow/strands";
import { TASK_STATE_LABEL } from "../flow/status";
import { useFlowLayout, type FlowRefs } from "../flow/useFlowLayout";
import { usePrefersReducedMotion } from "../flow/useReducedMotion";
import { AGENTS, AGENT_ORDER, type AgentId } from "../identity/agents";
import type { TaskCardData } from "../molecules/TaskCard";
import { ActiveTask } from "./ActiveTask";
import { AgentBlock } from "./AgentBlock";
import { DeliveryLane } from "./DeliveryLane";
import { QueueLane } from "./QueueLane";
import { Wires } from "./Wires";
import "./FlowCanvas.css";

interface Props {
  board: BoardModel;
  /** Pulses to play now. Live events and the demo mode both feed this one list. */
  pulses?: readonly Pulse[];
  onPulseEnd?: ((id: string) => void) | undefined;
  /** Fills the panel of an open block or task. */
  renderDetail?: RenderDetail | undefined;
}

const IDLE_TEXT: Record<NodeStatus, string> = {
  idle: "Waiting for the next prompt.",
  working: "Working…",
  done: "Finished.",
  failed: "Stopped.",
};

/**
 * The flow canvas: Claude, Knit and Cursor as a circuit, read left to right (top to bottom when narrow).
 * Claude sends the plan and its tasks through wires into Knit; Knit holds the queue at its input, the running
 * task at its center and the delivery lane at its output; Knit sends the prompt to Cursor and gets the result back.
 * Presentational: it draws the board it is given, and the pulses it is given.
 */
export function FlowCanvas({ board, pulses = [], onPulseEnd, renderDetail }: Props) {
  // One set of ref objects for the lifetime of the canvas: the layout hook depends on them.
  const [refs] = useState<FlowRefs>(() => ({ root: createRef(), claude: createRef(), knit: createRef(), cursor: createRef(), input: createRef(), core: createRef() }));
  const { orientation, layout, size } = useFlowLayout(refs);
  const reducedMotion = usePrefersReducedMotion();

  const geometry = useMemo(() => (layout === undefined ? { paths: [], ports: [] } : computeWires(layout, boardStrands(board))), [layout, board]);
  const accents = useMemo(() => Object.fromEntries(board.wires.map((w) => [w.id, AGENTS[w.from].accent])) as Record<WireId, string>, [board.wires]);

  const tasks = useMemo(() => new Map(board.tasks.map((t) => [t.taskId, t])), [board.tasks]);
  const queue: TaskCardData[] = board.queue.map((q) => {
    const task = tasks.get(q.taskId);
    return { taskId: q.taskId, title: q.title, position: q.position, state: task?.state ?? "queued", attempts: task?.attempts.filter((a) => !a.setup).length ?? 0, ...(q.dependsOn === undefined ? {} : { dependsOn: q.dependsOn }) };
  });
  const focus = board.active ? tasks.get(board.active.taskId) : board.tasks.find((t) => t.state === "failed");
  const delivered = board.totals.tasks.delivered;

  const liveFor = (id: AgentId) => (board.liveLine?.source === id ? board.liveLine : undefined);

  const blocks: Record<AgentId, ReactNode> = {
    claude: (
      <AgentBlock
        key="claude"
        ref={refs.claude}
        identity={AGENTS.claude}
        status={board.nodes.claude.status}
        tokens={board.totals.tokens.claude}
        renderDetail={renderDetail}
        summary={
          <>
            <span className="flow__plan">{board.nodes.claude.planName}</span>
            <span>{board.nodes.claude.taskCount === 1 ? "1 task handed over" : `${board.nodes.claude.taskCount} tasks handed over`}</span>
          </>
        }
      >
        <ul className="flow__delegated" aria-label="Delegated tasks">
          {board.tasks.map((task) => (
            <li className="flow__delegated-item" key={task.taskId} data-state={task.state} title={task.title}>
              <StateIcon state={task.state} />
              {task.taskId}
              <span className="sr-only">, {TASK_STATE_LABEL[task.state]}</span>
            </li>
          ))}
        </ul>
      </AgentBlock>
    ),
    knit: (
      <AgentBlock key="knit" ref={refs.knit} identity={AGENTS.knit} status={board.nodes.knit.status} renderDetail={renderDetail} summary={<span>{`${delivered} of ${board.totals.tasks.total} delivered`}</span>}>
        <div className="flow__knit">
          <QueueLane ref={refs.input} items={queue} renderDetail={renderDetail} />
          <ActiveTask ref={refs.core} task={focus} runStatus={board.runStatus} renderDetail={renderDetail} />
        </div>
        <DeliveryLane items={board.delivery} />
      </AgentBlock>
    ),
    cursor: (
      <AgentBlock
        key="cursor"
        ref={refs.cursor}
        identity={AGENTS.cursor}
        status={board.nodes.cursor.status}
        tokens={board.totals.tokens.cursor}
        showLive
        liveLine={liveFor("cursor")}
        idleText={IDLE_TEXT[board.nodes.cursor.status]}
        renderDetail={renderDetail}
      />
    ),
  };

  return (
    <div className="flow" ref={refs.root} data-layout={orientation}>
      <Wires wires={board.wires} geometry={geometry} size={size} pulses={pulses} accents={accents} reducedMotion={reducedMotion} onPulseEnd={onPulseEnd} />
      {AGENT_ORDER.map((id) => blocks[id])}
    </div>
  );
}

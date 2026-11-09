import type { BoardModel } from "@board";
import type { RenderDetail } from "../flow/detail";
import type { DetailSource } from "../detail/types";
import { ClaudeDetail } from "../organisms/ClaudeDetail";
import { KnitDetail } from "../organisms/KnitDetail";
import { TaskDetail } from "./TaskDetail";

/**
 * Builds the `renderDetail` the flow canvas calls for each open block: Claude shows the plan and specs, Knit its
 * verdicts and feedback, a task its attempts and changes. Cursor's block has no panel of its own: its work is
 * opened task by task. The agent is chosen by identity here, never by checking a name inside a component.
 */
export function createRenderDetail(board: BoardModel, source: DetailSource): RenderDetail {
  return (target) => {
    if (target.kind === "task") {
      const task = board.tasks.find((t) => t.taskId === target.taskId);
      return task ? <TaskDetail task={task} source={source} /> : undefined;
    }
    switch (target.id) {
      case "claude":
        return <ClaudeDetail planName={board.planName} planText={source.planText} tasks={board.tasks} />;
      case "knit":
        return <KnitDetail tasks={board.tasks} notes={source.attemptNotes} />;
      default:
        return undefined;
    }
  };
}

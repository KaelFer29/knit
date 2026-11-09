/** Labels and tones for task and node status. The state itself is computed in `src/core/board`; this only names it. */
import type { NodeStatus, TaskState } from "@board";

export const TASK_STATES: readonly TaskState[] = ["queued", "running", "retrying", "verifying", "delivered", "failed"];

export const TASK_STATE_LABEL: Record<TaskState, string> = {
  queued: "Queued",
  running: "Running",
  retrying: "Retrying",
  verifying: "Verifying",
  delivered: "Delivered",
  failed: "Failed",
};

export const NODE_STATUS_LABEL: Record<NodeStatus, string> = {
  idle: "Idle",
  working: "Working",
  done: "Done",
  failed: "Failed",
};

/** The task state whose look a block status borrows, so nodes and tasks share one palette. */
export const NODE_STATUS_TONE: Record<NodeStatus, TaskState> = {
  idle: "queued",
  working: "running",
  done: "delivered",
  failed: "failed",
};

/** States of a task the agent or Knit is working on right now. */
export const OPEN_STATES: readonly TaskState[] = ["running", "retrying", "verifying"];

export const isOpenState = (state: TaskState): boolean => OPEN_STATES.includes(state);

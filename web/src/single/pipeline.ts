/**
 * Pure derivations for the single view: what each hop of the pipeline is doing (its stage and the short lines of what
 * travels on it) and what each block shows without being opened. They read the board (`@board`, type-only) and a
 * small glimpse of the latest Claude session; no component decides a stage.
 */
import type { BoardModel, NodeStatus } from "@board";

export type HopId = "plan" | "prompt" | "result";
export type HopStatus = "idle" | "active" | "done" | "failed";

export interface HopView {
  id: HopId;
  from: "claude" | "knit" | "cursor";
  to: "claude" | "knit" | "cursor";
  /** Short name of the hop, for headings and screen readers. */
  label: string;
  /** Every stage the hop goes through, in order. */
  stages: readonly string[];
  /** The current stage text. */
  stage: string;
  /** Index of the current stage in `stages`, or -1 when none is reached yet. */
  stageIndex: number;
  status: HopStatus;
  /** At most three short lines of what travels on the hop. */
  lines: string[];
}

/** What the page knows about the latest Claude session. */
export interface SessionGlimpse {
  status: "idle" | "running";
  title: string;
  lastPrompt?: string;
  /** Last timeline entries as one line each, oldest first. */
  lines: string[];
}

export interface BlockView {
  status: NodeStatus;
  headline: string;
  lines: string[];
}

const MAX_LINE = 72;
const MAX_LINES = 3;

const clip = (text: string, max = MAX_LINE): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const head = flat.slice(0, max - 1);
  // Cut at a word boundary when one falls in the last third; otherwise the word is longer than that and is cut.
  const space = head.lastIndexOf(" ");
  const cut = space >= (max * 2) / 3 ? head.slice(0, space) : head;
  return `${cut.replace(/[\s.,;:\-–—]+$/, "")}…`;
};

/** Clip a line at a word boundary with an ellipsis. Exported for the tests and the full-text title. */
export const clipLine = clip;

const tidy = (lines: (string | undefined)[]): string[] =>
  lines.filter((l): l is string => l !== undefined && l.trim() !== "").slice(0, MAX_LINES).map((l) => clip(l));

const PLAN_STAGES = ["Plan drafted", "Plan sent", "Tasks queued"] as const;
const PROMPT_STAGES = ["Task queued", "Prompt sent", "Agent working"] as const;
const RESULT_STAGES = ["Result back", "Checks running", "Verdict"] as const;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

function planHop(board: BoardModel | undefined, session: SessionGlimpse | undefined): HopView {
  const base = { id: "plan", from: "claude", to: "knit", label: "Claude to Knit", stages: PLAN_STAGES } as const;
  const prompt = session?.lastPrompt === undefined ? undefined : `Claude: ${session.lastPrompt}`;
  if (board === undefined) {
    if (session?.status === "running") return { ...base, stage: "Plan drafted", stageIndex: 0, status: "active", lines: tidy([prompt]) };
    return { ...base, stage: "Waiting for a plan", stageIndex: -1, status: "idle", lines: tidy([prompt]) };
  }
  const queued = board.tasks.length > 0;
  return {
    ...base,
    stage: queued ? "Tasks queued" : "Plan sent",
    stageIndex: queued ? 2 : 1,
    status: "done",
    lines: tidy([session?.status === "running" ? prompt : undefined, `${board.planName}: ${plural(board.tasks.length, "task")}`]),
  };
}

function promptHop(board: BoardModel | undefined): HopView {
  const base = { id: "prompt", from: "knit", to: "cursor", label: "Knit to Cursor", stages: PROMPT_STAGES } as const;
  if (board === undefined) return { ...base, stage: "No task queued", stageIndex: -1, status: "idle", lines: [] };
  const { active } = board;
  if (active !== undefined) {
    const agentLine = board.liveLine !== undefined && board.liveLine.source !== "knit" ? board.liveLine.text : undefined;
    const working = active.state !== "verifying" && agentLine === undefined;
    const sent = active.state !== "verifying";
    return {
      ...base,
      stage: agentLine !== undefined || !sent ? "Agent working" : "Prompt sent",
      stageIndex: agentLine !== undefined || !sent ? 2 : 1,
      status: sent ? "active" : "done",
      lines: tidy([`${active.taskId} · ${active.title}`, active.attempt === undefined ? "Setup" : `Attempt ${active.attempt}${working ? " started" : ""}`, agentLine]),
    };
  }
  if (board.queue.length > 0) {
    const next = board.queue[0]!;
    return { ...base, stage: "Task queued", stageIndex: 0, status: board.runStatus === "running" ? "active" : "idle", lines: tidy([`${next.taskId} · ${next.title}`, `${plural(board.queue.length, "task")} waiting`]) };
  }
  return { ...base, stage: "All prompts sent", stageIndex: 2, status: "done", lines: tidy([`${plural(board.tasks.length, "task")} handled`]) };
}

function resultHop(board: BoardModel | undefined): HopView {
  const base = { id: "result", from: "cursor", to: "knit", label: "Cursor back to Knit", stages: RESULT_STAGES } as const;
  if (board === undefined) return { ...base, stage: "No result yet", stageIndex: -1, status: "idle", lines: [] };
  const { active } = board;
  const lastDelivered = board.delivery[board.delivery.length - 1];
  const delivered = lastDelivered === undefined ? undefined : `${lastDelivered.taskId} delivered${lastDelivered.commitSha === undefined ? "" : ` ${lastDelivered.commitSha.slice(0, 7)}`}`;
  if (active?.state === "verifying") {
    const checking = board.tasks.find((t) => t.taskId === active.taskId)?.attempts.find((a) => a.status === "verifying")?.checking;
    return { ...base, stage: "Checks running", stageIndex: 1, status: "active", lines: tidy([checking === undefined ? undefined : `check: ${checking}`, delivered]) };
  }
  if (active?.state === "retrying") {
    const failed = board.tasks.find((t) => t.taskId === active.taskId)?.attempts.find((a) => a.status === "failed")?.failedCheck;
    return { ...base, stage: "Verdict: retry", stageIndex: 2, status: "active", lines: tidy([failed === undefined ? "check failed" : `check failed: ${failed}`, `${active.taskId} goes again`]) };
  }
  if (active !== undefined) return { ...base, stage: "Waiting for result", stageIndex: 0, status: "idle", lines: tidy([delivered]) };
  const failed = board.tasks.find((t) => t.state === "failed");
  if (failed !== undefined) return { ...base, stage: "Verdict: failed", stageIndex: 2, status: "failed", lines: tidy([`${failed.taskId}: ${failed.failureReason ?? "failed"}`, delivered]) };
  if (board.tasks.length > 0 && board.tasks.every((t) => t.state === "delivered")) return { ...base, stage: "Verdict: delivered", stageIndex: 2, status: "done", lines: tidy([delivered]) };
  if (delivered !== undefined) return { ...base, stage: "Result back", stageIndex: 0, status: "done", lines: tidy([delivered]) };
  return { ...base, stage: "No result yet", stageIndex: -1, status: "idle", lines: [] };
}

/** Share of a hop's stages already reached, 0 to 1. Drives the fill of the stage track. */
export function hopProgress(hop: Pick<HopView, "stages" | "stageIndex">): number {
  return hop.stages.length === 0 ? 0 : Math.max(0, Math.min(1, (hop.stageIndex + 1) / hop.stages.length));
}

/** The three hops, in pipeline order: the plan goes to Knit, the prompt to Cursor, the result comes back. */
export function deriveHops(board: BoardModel | undefined, session: SessionGlimpse | undefined): HopView[] {
  return [planHop(board, session), promptHop(board), resultHop(board)];
}

/** What each block shows without being opened. */
export function deriveBlocks(board: BoardModel | undefined, session: SessionGlimpse | undefined): Record<"claude" | "knit" | "cursor", BlockView> {
  const claude: BlockView =
    session !== undefined
      ? { status: session.status === "running" ? "working" : board?.nodes.claude.status ?? "idle", headline: clip(session.title, 40), lines: tidy(session.lines.slice(-MAX_LINES).reverse()) }
      : board !== undefined
        ? { status: board.nodes.claude.status, headline: board.planName, lines: tidy([`${plural(board.nodes.claude.taskCount, "task")} planned`]) }
        : { status: "idle", headline: "No session yet", lines: [] };

  if (board === undefined) {
    return {
      claude,
      knit: { status: "idle", headline: "No run yet", lines: [] },
      cursor: { status: "idle", headline: "Nothing to build", lines: [] },
    };
  }
  const { active, liveLine } = board;
  const knit: BlockView = {
    status: board.nodes.knit.status,
    headline: board.planName,
    lines: tidy([
      `${board.totals.tasks.delivered} of ${board.totals.tasks.total} tasks delivered`,
      active === undefined ? `Run ${board.runStatus}` : `${active.taskId} ${active.state}`,
      liveLine?.source === "knit" ? liveLine.text : undefined,
    ]),
  };
  const attempt = active === undefined ? undefined : board.tasks.find((t) => t.taskId === active.taskId)?.attempts.find((a) => a.status === "running" || a.status === "verifying");
  const cursor: BlockView = {
    status: board.nodes.cursor.status,
    headline: active?.taskId ?? "No active task",
    lines: tidy([
      attempt === undefined ? undefined : attempt.setup ? "Setup" : `Attempt ${attempt.attempt} · ${attempt.status}`,
      active?.title,
      liveLine !== undefined && liveLine.source !== "knit" ? liveLine.text : undefined,
    ]),
  };
  return { claude, knit, cursor };
}

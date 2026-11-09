/**
 * Wire geometry: a pure function from the measured blocks to the SVG paths that join them.
 * Nothing here touches the DOM; the canvas measures the blocks and feeds rectangles in.
 *
 * Reading order is Claude, then Knit, then Cursor. Horizontally the plan runs left to right into
 * Knit's input zone, the prompt leaves Knit's core toward Cursor and the result comes back on a
 * parallel lane. Vertically the same flow runs top to bottom.
 */
import type { WireId } from "@board";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Orientation = "horizontal" | "vertical";

export interface FlowLayout {
  orientation: Orientation;
  claude: Rect;
  knit: Rect;
  cursor: Rect;
  /** The zone of Knit (the queue) the plan lands on: only its center across the flow is used. Defaults to the whole block. */
  knitInput?: Rect | undefined;
  /** The zone of Knit (the running task) the prompt leaves from and the result returns to: only its center across the flow is used. */
  knitCore?: Rect | undefined;
}

/** Task ids carried by each wire, in execution order. */
export interface StrandRequest {
  plan: readonly string[];
  prompt: readonly string[];
  result: readonly string[];
}

export interface WirePath {
  /** `plan:T3`, or the bare wire id (`prompt`) for an idle lane. */
  id: string;
  wire: WireId;
  taskId?: string;
  /** SVG path data. The strand runs from `from` to `to`, which is the direction a pulse travels. */
  d: string;
  from: Point;
  to: Point;
  /** True for the placeholder lane of a wire that carries nothing yet. */
  idle: boolean;
}

export interface WirePort {
  /** `plan:out`, `plan:in`, ... */
  id: string;
  at: Point;
}

export interface WireGeometry {
  paths: WirePath[];
  ports: WirePort[];
}

/** Gap between the prompt lane and the result lane, each side of the center line. */
const LANE = 10;
/** Distance between two strands of the plan ribbon, and the share of the block height the ribbon may use. */
const PLAN_STEP = 7;
const PLAN_SHARE = 0.6;
/** Distance between two strands that share the prompt or result lane, and the lane's total width. */
const LANE_STEP = 3;
const LANE_SPAN = 14;
/** Shortest bezier handle, so a short wire still leaves and arrives along the flow. */
const MIN_HANDLE = 24;

const round = (value: number) => Math.round(value * 10) / 10;

export const strandId = (wire: WireId, taskId: string) => `${wire}:${taskId}`;

/** Offsets that center `count` strands on zero, `step` apart, tightened so the ribbon fits `maxSpan`. */
export function spread(count: number, step: number, maxSpan: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const effective = Math.min(step, maxSpan / (count - 1));
  return Array.from({ length: count }, (_, i) => round((i - (count - 1) / 2) * effective * 1000) / 1000);
}

/** A cubic curve that leaves `from` and arrives at `to` along the flow axis. */
export function curvePath(from: Point, to: Point, orientation: Orientation): string {
  const delta = orientation === "horizontal" ? to.x - from.x : to.y - from.y;
  const handle = (delta < 0 ? -1 : 1) * Math.max(MIN_HANDLE, Math.abs(delta) / 2);
  const [c1, c2] =
    orientation === "horizontal"
      ? [
          { x: from.x + handle, y: from.y },
          { x: to.x - handle, y: to.y },
        ]
      : [
          { x: from.x, y: from.y + handle },
          { x: to.x, y: to.y - handle },
        ];
  return `M${round(from.x)} ${round(from.y)} C${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(to.x)} ${round(to.y)}`;
}

const centerX = (r: Rect) => r.x + r.width / 2;
const centerY = (r: Rect) => r.y + r.height / 2;
const right = (r: Rect) => r.x + r.width;
const bottom = (r: Rect) => r.y + r.height;

/** The point on a block's edge where a wire attaches: `side` picks the near or far edge along the flow, `cross` the position along it. */
function edge(r: Rect, orientation: Orientation, side: "start" | "end", cross: number): Point {
  if (orientation === "horizontal") return { x: side === "start" ? r.x : right(r), y: cross };
  return { x: cross, y: side === "start" ? r.y : bottom(r) };
}

/** Center of a rectangle across the flow axis (y when horizontal, x when vertical). */
const crossCenter = (r: Rect, orientation: Orientation) => (orientation === "horizontal" ? centerY(r) : centerX(r));
const crossSize = (r: Rect, orientation: Orientation) => (orientation === "horizontal" ? r.height : r.width);

const shift = (p: Point, orientation: Orientation, by: number): Point =>
  orientation === "horizontal" ? { x: p.x, y: p.y + by } : { x: p.x + by, y: p.y };

export function computeWires(layout: FlowLayout, strands: StrandRequest): WireGeometry {
  const { orientation, claude, knit, cursor } = layout;
  const input = layout.knitInput ?? knit;
  const core = layout.knitCore ?? knit;
  const paths: WirePath[] = [];
  const ports: WirePort[] = [];

  const lane = (wire: WireId, taskIds: readonly string[], base: { from: Point; to: Point }, step: number, maxSpan: number) => {
    ports.push({ id: `${wire}:out`, at: base.from }, { id: `${wire}:in`, at: base.to });
    if (taskIds.length === 0) {
      paths.push({ id: wire, wire, d: curvePath(base.from, base.to, orientation), from: base.from, to: base.to, idle: true });
      return;
    }
    const offsets = spread(taskIds.length, step, maxSpan);
    taskIds.forEach((taskId, i) => {
      const by = offsets[i] ?? 0;
      const from = shift(base.from, orientation, by);
      const to = shift(base.to, orientation, by);
      paths.push({ id: strandId(wire, taskId), wire, taskId, d: curvePath(from, to, orientation), from, to, idle: false });
    });
  };

  const planSpan = Math.min(crossSize(claude, orientation), crossSize(input, orientation)) * PLAN_SHARE;
  lane(
    "plan",
    strands.plan,
    {
      from: edge(claude, orientation, "end", crossCenter(claude, orientation)),
      to: edge(knit, orientation, "start", crossCenter(input, orientation)),
    },
    PLAN_STEP,
    planSpan,
  );

  // Prompt and result run side by side: the prompt on the lane before the center line, the result after it.
  lane(
    "prompt",
    strands.prompt,
    {
      from: edge(knit, orientation, "end", crossCenter(core, orientation) - LANE),
      to: edge(cursor, orientation, "start", crossCenter(cursor, orientation) - LANE),
    },
    LANE_STEP,
    LANE_SPAN,
  );
  lane(
    "result",
    strands.result,
    {
      from: edge(cursor, orientation, "start", crossCenter(cursor, orientation) + LANE),
      to: edge(knit, orientation, "end", crossCenter(core, orientation) + LANE),
    },
    LANE_STEP,
    LANE_SPAN,
  );

  return { paths, ports };
}

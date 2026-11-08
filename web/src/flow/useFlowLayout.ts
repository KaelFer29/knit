import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";
import type { FlowLayout, Orientation, Rect } from "./geometry";

/** Canvas width from which the three blocks sit side by side. Below it the flow runs top to bottom. */
export const WIDE_MIN = 1120;

type Ref = RefObject<HTMLElement | null>;

export interface FlowRefs {
  root: RefObject<HTMLDivElement | null>;
  claude: Ref;
  knit: Ref;
  cursor: Ref;
  /** The queue zone inside Knit. */
  input: Ref;
  /** The running task zone inside Knit. */
  core: Ref;
}

export interface FlowMeasure {
  orientation: Orientation;
  /** Absent until the blocks have been measured. */
  layout?: FlowLayout;
  size: { width: number; height: number };
}

const INITIAL: FlowMeasure = { orientation: "horizontal", size: { width: 0, height: 0 } };

const half = (value: number) => Math.round(value * 2) / 2;
const same = (a: FlowMeasure, b: FlowMeasure) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Measures the blocks relative to the canvas and picks the orientation from the canvas width.
 * It re-measures whenever the canvas or any block changes size (a ResizeObserver) and whenever the window
 * resizes, so the wires always land on the edges they belong to. Without ResizeObserver (old browsers, jsdom)
 * it measures on mount and on window resize.
 */
export function useFlowLayout(refs: FlowRefs): FlowMeasure {
  const [measure, setMeasure] = useState<FlowMeasure>(INITIAL);

  const update = useCallback(() => {
    const root = refs.root.current;
    if (root === null) return;
    const base = root.getBoundingClientRect();
    const rect = (ref: Ref): Rect | undefined => {
      const el = ref.current;
      if (el === null) return undefined;
      const b = el.getBoundingClientRect();
      return { x: half(b.left - base.left), y: half(b.top - base.top), width: half(b.width), height: half(b.height) };
    };
    // A canvas with no width has not been laid out (jsdom, or hidden): keep the wide default.
    const orientation: Orientation = base.width === 0 || base.width >= WIDE_MIN ? "horizontal" : "vertical";
    const claude = rect(refs.claude);
    const knit = rect(refs.knit);
    const cursor = rect(refs.cursor);
    const next: FlowMeasure = {
      orientation,
      size: { width: half(base.width), height: half(base.height) },
      ...(claude && knit && cursor ? { layout: { orientation, claude, knit, cursor, knitInput: rect(refs.input), knitCore: rect(refs.core) } } : {}),
    };
    setMeasure((previous) => (same(previous, next) ? previous : next));
  }, [refs]);

  // Measure before paint, and again after the orientation changed the layout.
  useLayoutEffect(() => {
    update();
  }, [update, measure.orientation]);

  useEffect(() => {
    const observed = [refs.root, refs.claude, refs.knit, refs.cursor, refs.input, refs.core].map((r) => r.current).filter((el): el is HTMLElement => el !== null);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    for (const el of observed) observer?.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [refs, update]);

  return measure;
}

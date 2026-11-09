import { useCallback, useEffect, useState } from "react";
import type { BoardModel } from "@board";
import { demoPulse, type Pulse } from "./pulses";

/** Time between two demo pulses. */
const DEMO_INTERVAL_MS = 1_000;
/** Pulses that never end (a hidden tab pauses animations) cannot pile up beyond this. */
const MAX_PULSES = 6;

/**
 * DEMO MODE ONLY. Plays dispatch, prompt and result pulses on a board so the motion can be seen and screenshotted
 * without live events. A live source replaces this hook and feeds the same `Pulse` list to the canvas.
 */
export function useDemoPulses(board: BoardModel, enabled: boolean): { pulses: Pulse[]; onPulseEnd: (id: string) => void } {
  const [pulses, setPulses] = useState<Pulse[]>([]);

  useEffect(() => {
    if (!enabled) {
      setPulses([]);
      return;
    }
    let step = 0;
    const play = () => {
      const pulse = demoPulse(board, step);
      step += 1;
      if (pulse !== undefined) setPulses((list) => [...list, pulse].slice(-MAX_PULSES));
    };
    play();
    const timer = setInterval(play, DEMO_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [board, enabled]);

  const onPulseEnd = useCallback((id: string) => setPulses((list) => list.filter((p) => p.id !== id)), []);
  return { pulses, onPulseEnd };
}

import { useEffect, useRef, type CSSProperties } from "react";
import type { WireId, WireView } from "@board";
import type { WireGeometry, WirePath } from "../flow/geometry";
import type { Pulse } from "../flow/pulses";
import { resolvePulsePath } from "../flow/strands";
import { isOpenState } from "../flow/status";
import "../styles/states.css";
import "./Wires.css";

interface Props {
  wires: readonly WireView[];
  geometry: WireGeometry;
  /** Size of the canvas the geometry was measured in. */
  size: { width: number; height: number };
  /** Pulses to show now. The owner removes each one when `onPulseEnd` fires. */
  pulses?: readonly Pulse[];
  /** Pulse color per wire: the accent of the block the wire starts from. */
  accents: Record<WireId, string>;
  reducedMotion: boolean;
  onPulseEnd?: ((id: string) => void) | undefined;
}

/** How long a strand stays highlighted when motion is reduced, in place of a travelling dot. */
const HIGHLIGHT_MS = 1_800;

/**
 * The SVG overlay behind the blocks: one strand per task, ports where wires meet blocks, and pulses.
 * Presentational: geometry comes from `computeWires`, pulses from whoever owns them (live events or the demo).
 */
export function Wires({ wires, geometry, size, pulses = [], accents, reducedMotion, onPulseEnd }: Props) {
  const stateOf = (path: WirePath) => wires.find((w) => w.id === path.wire)?.strands.find((s) => s.taskId === path.taskId)?.state;

  // The plan wire carries one task at a time into Knit: the next one in the queue.
  const nextQueued = wires.find((w) => w.id === "plan")?.strands.find((s) => s.state === "queued")?.taskId;
  const flowing = (path: WirePath) => {
    const wire = wires.find((w) => w.id === path.wire);
    const state = stateOf(path);
    if (wire === undefined || !wire.active || path.idle || state === undefined) return false;
    return wire.id === "plan" ? path.taskId === nextQueued : isOpenState(state);
  };

  return (
    <svg className="wires" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {geometry.paths.map((path) => (
        <path
          key={path.id}
          className="wires__strand"
          d={path.d}
          data-wire={path.wire}
          data-task={path.taskId}
          data-state={stateOf(path)}
          data-idle={path.idle ? "true" : undefined}
          data-flowing={flowing(path) ? "true" : undefined}
        />
      ))}
      {geometry.ports.map((port) => (
        <circle key={port.id} className="wires__port" cx={port.at.x} cy={port.at.y} r={3.5} />
      ))}
      {pulses.map((pulse) => {
        const path = resolvePulsePath(geometry.paths, pulse.wireId);
        if (path === undefined) return null;
        const color = accents[path.wire];
        return reducedMotion ? (
          <PulseHighlight key={pulse.id} pulse={pulse} path={path} color={color} onEnd={onPulseEnd} />
        ) : (
          <circle
            key={pulse.id}
            className="wires__pulse"
            r={4.5}
            data-kind={pulse.kind}
            data-wire={pulse.wireId}
            style={{ "--pulse-color": color, "--pulse-path": `path("${path.d}")` } as CSSProperties}
            onAnimationEnd={() => onPulseEnd?.(pulse.id)}
          />
        );
      })}
    </svg>
  );
}

/** Reduced motion: the strand stays lit for a moment instead of a dot travelling along it. */
function PulseHighlight({ pulse, path, color, onEnd }: { pulse: Pulse; path: WirePath; color: string; onEnd: ((id: string) => void) | undefined }) {
  const latest = useRef(onEnd);
  latest.current = onEnd;
  useEffect(() => {
    const timer = setTimeout(() => latest.current?.(pulse.id), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [pulse.id]);
  return <path className="wires__highlight" d={path.d} data-kind={pulse.kind} data-wire={pulse.wireId} style={{ "--pulse-color": color } as CSSProperties} />;
}

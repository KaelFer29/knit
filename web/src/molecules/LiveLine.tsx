import type { LiveLine as LiveLineData } from "@board";
import "./LiveLine.css";

interface Props {
  line?: LiveLineData | undefined;
  /** Shown when there is no line: the agent is waiting, finished or stopped. */
  idleText?: string | undefined;
}

const iconProps = { viewBox: "0 0 16 16", width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false } as const;

/** Which glyph a timeline entry kind gets: a tool call, a message, a check, or a plain dot. */
function glyph(kind: string) {
  if (kind.startsWith("tool")) return <path d="M9.8 2.6a3.4 3.4 0 0 0-3.3 4.3L2.7 10.7a1.4 1.4 0 0 0 2 2l3.8-3.8a3.4 3.4 0 0 0 4.3-3.3l-2 2-1.9-.5-.5-1.9z" />;
  if (kind === "check") return <path d="M8 2 3 4v4c0 3 2 5 5 6 3-1 5-3 5-6V4zM5.8 8l1.7 1.7 3-3.2" />;
  if (kind === "message") return <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />;
  return <circle cx="8" cy="8" r="2" />;
}

/**
 * The single line that says what an agent is doing right now. The text comes from the agent and is untrusted:
 * it is rendered as text and clipped, with the full text in the tooltip.
 */
export function LiveLine({ line, idleText }: Props) {
  if (line === undefined) {
    return idleText === undefined ? null : <p className="live-line live-line--idle">{idleText}</p>;
  }
  const mono = line.kind.startsWith("tool") || line.kind === "check";
  return (
    <p className="live-line" data-kind={line.kind}>
      <svg {...iconProps}>{glyph(line.kind)}</svg>
      <span className="live-line__body">
        <span className="live-line__label">Now</span>
        <span className="live-line__text" data-mono={mono ? "true" : undefined} title={line.text}>
          {line.text}
        </span>
      </span>
    </p>
  );
}

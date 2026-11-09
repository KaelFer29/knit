import { formatDuration, formatTokens } from "../flow/format";
import type { TimelineItem } from "../sessions/timeline";
import "./TimelineEntry.css";

/** `10:42` in the reader's locale, or nothing for a date that cannot be read. */
function clock(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * One entry of the shared timeline. Every agent's session renders through this: messages, reasoning (or the note that
 * the agent does not share it), tool calls with arguments and result, and the closing result with its tokens.
 * Agent output is untrusted: it is only ever placed in the page as text.
 */
export function TimelineEntry({ item }: { item: TimelineItem }) {
  switch (item.type) {
    case "prompt":
      return (
        <div className="tl-entry tl-entry--prompt" data-side="me">
          <span className="sr-only">You said: </span>
          <p className="tl-entry__text">{item.text}</p>
          <span className="tl-entry__time">
            {item.model ? `${item.model} · ` : ""}
            {clock(item.at)}
          </span>
        </div>
      );
    case "message":
      return (
        <div className="tl-entry tl-entry--message" data-side="agent">
          <p className="tl-entry__text">{item.text}</p>
          <span className="tl-entry__time">{clock(item.at)}</span>
        </div>
      );
    case "thinking":
      return item.shared ? (
        <details className="tl-entry tl-entry--thinking">
          <summary>Reasoning</summary>
          <p className="tl-entry__text">{item.text}</p>
        </details>
      ) : (
        <div className="tl-entry tl-entry--thinking tl-entry--muted">Reasoning not shared by the agent</div>
      );
    case "tool":
      return (
        <details className="tl-entry tl-entry--tool" data-state={item.isError ? "failed" : item.done ? "done" : "running"}>
          <summary>
            <span className="tl-entry__tool">{item.tool}</span>
            <span className="tl-entry__state">{item.isError ? "failed" : item.done ? "done" : "running"}</span>
          </summary>
          {item.args ? (
            <>
              <div className="tl-entry__meta">Arguments</div>
              <pre className="tl-entry__pre">{item.args}</pre>
            </>
          ) : null}
          {item.result ? (
            <>
              <div className="tl-entry__meta">Result</div>
              <pre className="tl-entry__pre">{item.result}</pre>
            </>
          ) : null}
        </details>
      );
    case "result": {
      const tokens = (item.inputTokens ?? 0) + (item.outputTokens ?? 0);
      return (
        <div className="tl-entry tl-entry--result" data-side="agent" data-state={item.isError ? "failed" : "done"}>
          <div className="tl-entry__meta">
            {item.isError ? "Turn failed" : "Turn finished"}
            {item.durationMs !== undefined ? ` · ${formatDuration(item.durationMs)}` : ""}
            {tokens > 0 ? ` · ${formatTokens(item.inputTokens ?? 0)} in, ${formatTokens(item.outputTokens ?? 0)} out` : ""}
          </div>
          {item.text ? <p className="tl-entry__text">{item.text}</p> : null}
        </div>
      );
    }
    case "working":
      return (
        <div className="tl-entry tl-entry--working" role="status">
          <span className="tl-entry__dots" aria-hidden="true" />
          Working
        </div>
      );
  }
}

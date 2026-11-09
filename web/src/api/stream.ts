/**
 * Client of `GET /api/runs/:id/stream` (Server-Sent Events).
 *
 * Every message id is the pair `<lastEventId>.<lastAgentEventId>` (see docs/web-interface.md). A browser that
 * reconnects by itself sends it as `Last-Event-ID`; when the browser gives up (the connection was refused or the
 * server restarted) this client opens a new `EventSource` that starts from the same pair with `?after=`, so no
 * message is lost or repeated either way. The stream is closed on `done`.
 */

export interface StreamedEvent {
  id: number;
  type: string;
  taskId?: string;
  attempt?: number;
  ts?: string;
  payload?: unknown;
}

export interface StreamedAgentEvent {
  id: number;
  kind: string;
  taskId?: string;
  attempt?: number;
  agent?: string;
}

export type StreamConnection = "connecting" | "open" | "reconnecting" | "closed";

export interface StreamHandlers {
  onEvent?: (event: StreamedEvent) => void;
  onAgentEvent?: (event: StreamedAgentEvent) => void;
  /** The run ended and every row was delivered; the stream is already closed. */
  onDone?: (status: string | null) => void;
  onConnection?: (state: StreamConnection) => void;
}

export interface StreamOptions {
  /** Resume point `<lastEventId>.<lastAgentEventId>`, usually from the snapshot just fetched. */
  after?: string;
  /** Delay before reopening a connection the browser gave up on. Grows up to `maxRetryMs`. */
  retryMs?: number;
  maxRetryMs?: number;
  /** Injected in tests. */
  eventSource?: (url: string) => EventSource;
}

const CURSOR = /^\d+\.\d+$/;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function parse(data: unknown): unknown {
  try {
    return typeof data === "string" ? JSON.parse(data) : undefined;
  } catch {
    return undefined;
  }
}

/** Opens the stream and returns a function that closes it for good. */
export function openRunStream(runId: string, handlers: StreamHandlers, options: StreamOptions = {}): () => void {
  const open = options.eventSource ?? ((url: string) => new EventSource(url));
  const baseDelay = options.retryMs ?? 1_000;
  const maxDelay = options.maxRetryMs ?? 15_000;
  let cursor = options.after !== undefined && CURSOR.test(options.after) ? options.after : "0.0";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let source: EventSource | undefined;
  let stopped = false;
  let failures = 0;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    source?.close();
    source = undefined;
    handlers.onConnection?.("closed");
  };

  const connect = (): void => {
    if (stopped) return;
    const es = open(`/api/runs/${encodeURIComponent(runId)}/stream?after=${cursor}`);
    source = es;
    handlers.onConnection?.(failures === 0 ? "connecting" : "reconnecting");

    es.onopen = () => {
      failures = 0;
      handlers.onConnection?.("open");
    };
    const message = (e: Event): unknown => {
      const m = e as MessageEvent;
      if (typeof m.lastEventId === "string" && CURSOR.test(m.lastEventId)) cursor = m.lastEventId;
      return parse(m.data);
    };
    es.addEventListener("event", (e) => {
      const data = message(e);
      if (isRecord(data)) handlers.onEvent?.(data as unknown as StreamedEvent);
    });
    es.addEventListener("agent_event", (e) => {
      const data = message(e);
      if (isRecord(data)) handlers.onAgentEvent?.(data as unknown as StreamedAgentEvent);
    });
    es.addEventListener("done", (e) => {
      const data = parse((e as MessageEvent).data);
      const status = isRecord(data) && typeof data.status === "string" ? data.status : null;
      stop();
      handlers.onDone?.(status);
    });
    es.onerror = () => {
      if (stopped) return;
      handlers.onConnection?.("reconnecting");
      if (es.readyState !== 2 /* CLOSED */) return; // CONNECTING: the browser retries and sends Last-Event-ID.
      // The browser will not retry: reopen from the last cursor, with a growing delay.
      es.close();
      source = undefined;
      failures += 1;
      timer = setTimeout(connect, Math.min(maxDelay, baseDelay * 2 ** (failures - 1)));
    };
  };

  connect();
  return stop;
}

import type { RunStatus } from "../../core/ports/run-store.js";
import { BASE_HEADERS, HttpError } from "../http.js";
import type { RouteContext, RouteModule, ServerDeps } from "../types.js";
import { requireSnapshot } from "./runs.js";

/** Rows read per poll, so replaying a long run streams in slices instead of one huge read. */
const BATCH = 500;
const CURSOR = /^(\d+)\.(\d+)$/;

/**
 * Lifecycle events and agent events have separate id sequences, so one SSE id carries both cursors:
 * `<lastEventId>.<lastAgentEventId>`. Every frame's id is the pair of cursors right after that frame, which makes
 * `Last-Event-ID` resume exactly there: no gap and no duplicate. Within a poll, lifecycle rows are sent first.
 */
export function parseCursor(raw: string): { eventId: number; agentEventId: number } | undefined {
  const m = CURSOR.exec(raw);
  if (!m) return undefined;
  const eventId = Number(m[1]);
  const agentEventId = Number(m[2]);
  return Number.isSafeInteger(eventId) && Number.isSafeInteger(agentEventId) ? { eventId, agentEventId } : undefined;
}

const frame = (id: string, event: string, data: unknown): string =>
  `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** `GET /api/runs/:id/stream`: Server-Sent Events over a polled read, resumable with `Last-Event-ID` (or `?after=`). */
export const streamRoutes: RouteModule = (deps) => [
  { method: "GET", pattern: "/api/runs/:id/stream", handler: (ctx) => openStream(deps, ctx) },
];

function openStream(deps: ServerDeps, { req, res, url, params }: RouteContext): Promise<void> {
  const { reader } = deps;
  const runId = params.id!;
  requireSnapshot(reader, runId);

  // The header wins: a reconnecting EventSource keeps its original URL but sends the last id it saw.
  const header = req.headers["last-event-id"];
  const raw = (Array.isArray(header) ? header[0] : header) || url.searchParams.get("after") || "0.0";
  const start = parseCursor(raw);
  if (!start) throw new HttpError(400, "Last-Event-ID must look like <eventId>.<agentEventId>");
  let { eventId, agentEventId } = start;

  res.writeHead(200, {
    ...BASE_HEADERS,
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 2000\n\n");

  return new Promise<void>((resolve) => {
    let closed = false;
    let timer: NodeJS.Timeout | undefined;
    let finished = false;
    let finalStatus: RunStatus | undefined;
    let lastStatusCheck = -Infinity;

    const heartbeat = setInterval(() => res.write(": ping\n\n"), deps.heartbeatMs);
    const stop = (): void => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      resolve();
    };
    res.on("close", stop);

    const tick = (): void => {
      if (closed) return;
      let again = deps.pollIntervalMs;
      try {
        // The status is read before the rows: whatever the run wrote before it finished is then already readable.
        if (!finished && deps.now() - lastStatusCheck >= deps.statusIntervalMs) {
          lastStatusCheck = deps.now();
          const status = reader.getRunSnapshot(runId)?.run.status;
          finalStatus = status;
          finished = status !== "running";
        }
        const events = reader.getEventsAfter(runId, eventId, BATCH);
        const agentEvents = reader.getAgentEventsAfter(runId, agentEventId, { limit: BATCH });
        for (const e of events) {
          eventId = e.id;
          res.write(frame(`${eventId}.${agentEventId}`, "event", e));
        }
        for (const a of agentEvents) {
          agentEventId = a.id;
          res.write(frame(`${eventId}.${agentEventId}`, "agent_event", a));
        }
        if (events.length === 0 && agentEvents.length === 0 && finished) {
          res.write(`event: done\ndata: ${JSON.stringify({ status: finalStatus ?? null })}\n\n`);
          res.end();
          stop();
          return;
        }
        if (events.length === BATCH || agentEvents.length === BATCH) again = 0;
      } catch {
        // A read can fail while another process migrates or writes; the next poll tries again.
      }
      timer = setTimeout(tick, again);
    };
    timer = setTimeout(tick, 0);
  });
}

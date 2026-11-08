import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardModel } from "@board";
import { apiGet } from "../api/client";
import { openRunStream, type StreamConnection, type StreamOptions } from "../api/stream";
import type { Pulse } from "../flow/pulses";
import { pulseForEvent } from "./pulses";

/** What `GET /api/runs/:id` returns that the page needs. */
export interface RunDetail {
  board: BoardModel;
  lastEventId: number;
  lastAgentEventId: number;
}

/** Pulses that never end (a hidden tab pauses animations) cannot pile up beyond this. */
const MAX_PULSES = 8;
/** Rows arrive in bursts; the board is refetched at most this often. */
const REFRESH_MS = 400;

export interface UseBoardOptions {
  fetchDetail?: (runId: string) => Promise<RunDetail>;
  eventSource?: StreamOptions["eventSource"];
  refreshMs?: number;
}

export interface LiveBoard {
  board: BoardModel | undefined;
  connection: StreamConnection | "idle";
  error: string | undefined;
  pulses: Pulse[];
  onPulseEnd: (id: string) => void;
}

const defaultFetch = (runId: string) => apiGet<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`);

/**
 * Container hook: the board of one run, kept current from the live stream. The server derives the board, so each burst
 * of rows triggers one refetch; the stream starts right after the snapshot it was fetched with, so no row is missed
 * or replayed, and lifecycle events also play pulses on the wires. Closes the stream when the run ends or the
 * component unmounts. With no `runId` it does nothing.
 */
export function useBoard(runId: string | undefined, options: UseBoardOptions = {}): LiveBoard {
  const [board, setBoard] = useState<BoardModel>();
  const [connection, setConnection] = useState<LiveBoard["connection"]>("idle");
  const [error, setError] = useState<string>();
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (runId === undefined) {
      setBoard(undefined);
      setConnection("idle");
      setError(undefined);
      setPulses([]);
      return;
    }
    let disposed = false;
    let closeStream: (() => void) | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let version = 0;
    const fetchDetail = optionsRef.current.fetchDetail ?? defaultFetch;
    const refreshMs = optionsRef.current.refreshMs ?? REFRESH_MS;

    const refresh = (): void => {
      const mine = ++version;
      fetchDetail(runId).then(
        (detail) => {
          if (disposed || mine !== version) return;
          setBoard(detail.board);
          setError(undefined);
        },
        (err: unknown) => {
          if (!disposed && mine === version) setError(err instanceof Error ? err.message : String(err));
        },
      );
    };
    const scheduleRefresh = (): void => {
      if (refreshTimer !== undefined) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        refresh();
      }, refreshMs);
    };

    setConnection("connecting");
    const first = ++version;
    fetchDetail(runId).then(
      (detail) => {
        if (disposed) return;
        if (first === version) setBoard(detail.board);
        setError(undefined);
        closeStream = openRunStream(
          runId,
          {
            onEvent: (event) => {
              const pulse = pulseForEvent(event);
              if (pulse) setPulses((list) => [...list, pulse].slice(-MAX_PULSES));
              scheduleRefresh();
            },
            onAgentEvent: scheduleRefresh,
            onConnection: (state) => {
              if (disposed) return;
              setConnection(state);
              // A reopened stream resumes without gaps, but a refetch also recovers anything the page missed offline.
              if (state === "open") scheduleRefresh();
            },
            onDone: () => {
              clearTimeout(refreshTimer);
              refreshTimer = undefined;
              refresh();
            },
          },
          {
            after: `${detail.lastEventId}.${detail.lastAgentEventId}`,
            ...(optionsRef.current.eventSource ? { eventSource: optionsRef.current.eventSource } : {}),
          },
        );
      },
      (err: unknown) => {
        if (disposed) return;
        setConnection("closed");
        setError(err instanceof Error ? err.message : String(err));
      },
    );

    return () => {
      disposed = true;
      clearTimeout(refreshTimer);
      closeStream?.();
    };
  }, [runId]);

  const onPulseEnd = useCallback((id: string) => setPulses((list) => list.filter((p) => p.id !== id)), []);
  return { board, connection, error, pulses, onPulseEnd };
}

import type { RunListItem, RunReader, RunSnapshot, StoredAgentEvent, StoredEvent } from "../core/ports/run-reader.js";

/**
 * A `RunReader` for a database that may not exist yet. `open` returns a reader once the database is there (and
 * undefined before that); until then every read is empty. A reader that throws is closed and opened again on the next
 * call, so a database that is replaced or still being created does not wedge the server.
 */
export function lazyRunReader(open: () => RunReader | undefined): RunReader {
  let inner: RunReader | undefined;

  function use<T>(fallback: T, read: (reader: RunReader) => T): T {
    if (!inner) {
      try {
        inner = open();
      } catch {
        inner = undefined;
      }
    }
    if (!inner) return fallback;
    try {
      return read(inner);
    } catch (err) {
      try {
        inner.close();
      } catch {
        // already unusable
      }
      inner = undefined;
      throw err;
    }
  }

  return {
    listRuns: (): RunListItem[] => use([], (r) => r.listRuns()),
    getRunSnapshot: (runId): RunSnapshot | undefined => use(undefined, (r) => r.getRunSnapshot(runId)),
    getEventsAfter: (runId, afterId, limit): StoredEvent[] => use([], (r) => r.getEventsAfter(runId, afterId, limit)),
    getAgentEventsAfter: (runId, afterId, filter): StoredAgentEvent[] =>
      use([], (r) => r.getAgentEventsAfter(runId, afterId, filter)),
    close: () => {
      inner?.close();
      inner = undefined;
    },
  };
}

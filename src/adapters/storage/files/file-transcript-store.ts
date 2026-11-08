import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { AgentEvent } from "../../../core/ports/agent-runner.js";
import type { Transcript, TranscriptStore } from "../../../core/ports/transcript.js";

const safe = (part: string): string => part.replace(/[^\w.-]/g, "_");

/** Keeps the raw stream of every attempt as JSON lines: <root>/<run>/<task>-attempt-<n>.jsonl */
export class FileTranscriptStore implements TranscriptStore {
  constructor(private readonly root: string) {}

  open(ctx: { runId: string; taskId: string; attempt: number }): Transcript {
    const dir = join(this.root, safe(ctx.runId));
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${safe(ctx.taskId)}-attempt-${ctx.attempt}.jsonl`);
    let fd: number | undefined = openSync(path, "a");
    return {
      path,
      append(event: AgentEvent): void {
        if (fd !== undefined) writeSync(fd, `${JSON.stringify(event.raw)}\n`);
      },
      close(): void {
        if (fd !== undefined) closeSync(fd);
        fd = undefined;
      },
    };
  }
}

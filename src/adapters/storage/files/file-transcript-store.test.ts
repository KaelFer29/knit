import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileTranscriptStore } from "./file-transcript-store.js";

let root: string;
beforeEach(() => void (root = mkdtempSync(join(tmpdir(), "orq-tr-"))));
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("FileTranscriptStore", () => {
  it("writes every raw event as one JSON line under <root>/<run>/<task>-attempt-<n>.jsonl", () => {
    const store = new FileTranscriptStore(join(root, "logs"));
    const t = store.open({ runId: "run-1", taskId: "T1", attempt: 2 });
    expect(t.path).toBe(join(root, "logs", "run-1", "T1-attempt-2.jsonl"));
    t.append({ type: "system", raw: { type: "system", n: 1 } });
    t.append({ type: "result", raw: { type: "result", text: "a\nb" } });
    t.close();
    const lines = readFileSync(t.path, "utf8").trimEnd().split("\n");
    expect(lines.map((l) => JSON.parse(l))).toEqual([{ type: "system", n: 1 }, { type: "result", text: "a\nb" }]);
  });

  it("keeps separate files per attempt and tolerates close() twice", () => {
    const store = new FileTranscriptStore(root);
    const a = store.open({ runId: "r", taskId: "T1", attempt: 1 });
    const b = store.open({ runId: "r", taskId: "T1", attempt: 2 });
    expect(a.path).not.toBe(b.path);
    a.close();
    expect(() => a.close()).not.toThrow();
    b.close();
  });
});

export type PatchLineKind = "hunk" | "add" | "del" | "ctx" | "note";

export interface PatchLine {
  kind: PatchLineKind;
  text: string;
  /** Line numbers in the old and new file; absent on hunk headers and notes. */
  oldNo?: number;
  newNo?: number;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Splits the hunks of a unified diff into typed lines with their line numbers. Pure; the text is never interpreted. */
export function parsePatch(patch: string): PatchLine[] {
  const lines: PatchLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  const raw = patch.split("\n");
  if (raw.at(-1) === "") raw.pop();
  for (const text of raw) {
    const hunk = HUNK.exec(text);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      lines.push({ kind: "hunk", text });
    } else if (text.startsWith("+")) {
      lines.push({ kind: "add", text: text.slice(1), newNo: newNo++ });
    } else if (text.startsWith("-")) {
      lines.push({ kind: "del", text: text.slice(1), oldNo: oldNo++ });
    } else if (text.startsWith("\\")) {
      lines.push({ kind: "note", text });
    } else {
      lines.push({ kind: "ctx", text: text.slice(1), oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return lines;
}

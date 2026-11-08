/** Line diff for the configuration editor: what the user is about to save, against what was read. Pure. */

export type DiffKind = "same" | "add" | "del";

export interface DiffLine {
  kind: DiffKind;
  text: string;
  /** 1-based line number in the old text; absent for added lines. */
  oldNumber?: number;
  /** 1-based line number in the new text; absent for removed lines. */
  newNumber?: number;
}

export type DiffItem = DiffLine | { kind: "skip"; count: number };

const split = (text: string): string[] => (text === "" ? [] : text.split("\n"));

/**
 * Longest-common-subsequence diff by lines. The common head and tail are peeled off first, so the quadratic table only
 * covers the part that changed (config files are small, and edits are local).
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = split(oldText);
  const b = split(newText);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const n = midA.length;
  const m = midB.length;
  // lcs[i][j]: length of the common subsequence of midA[i..] and midB[j..].
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = midA[i] === midB[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  const same = (text: string): void => {
    out.push({ kind: "same", text, oldNumber: oldNo++, newNumber: newNo++ });
  };
  for (let k = 0; k < head; k++) same(a[k]!);
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && midA[i] === midB[j]) {
      same(midA[i]!);
      i++;
      j++;
    } else if (i < n && (j >= m || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      out.push({ kind: "del", text: midA[i]!, oldNumber: oldNo++ });
      i++;
    } else {
      out.push({ kind: "add", text: midB[j]!, newNumber: newNo++ });
      j++;
    }
  }
  for (let k = a.length - tail; k < a.length; k++) same(a[k]!);
  return out;
}

export const isChanged = (lines: DiffLine[]): boolean => lines.some((l) => l.kind !== "same");

/** Keeps `context` unchanged lines around every change and folds longer runs of unchanged lines into one `skip`. */
export function withContext(lines: DiffLine[], context: number): DiffItem[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.kind === "same") return;
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k++) keep[k] = true;
  });
  const items: DiffItem[] = [];
  let skipped = 0;
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (skipped > 0) items.push({ kind: "skip", count: skipped });
      skipped = 0;
      items.push(line);
    } else skipped++;
  });
  if (skipped > 0) items.push({ kind: "skip", count: skipped });
  return items;
}

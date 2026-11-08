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

/** Above this many table cells (changed lines of one side times the other) the quadratic table is not built. */
export const MAX_DIFF_CELLS = 1_000_000;
/** The greedy diff used instead gives up past this many edited lines and the block is shown as replaced. */
const MAX_EDITS = 2_000;

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
  if (n * m > MAX_DIFF_CELLS) return largeDiff(a, b, head, tail, midA, midB);
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

/** Fallback for huge edits: keep the common head and tail, show everything between as removed then added. */
function replaceBlock(a: string[], b: string[], head: number, tail: number): DiffLine[] {
  const out: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (let k = 0; k < head; k++) out.push({ kind: "same", text: a[k]!, oldNumber: oldNo++, newNumber: newNo++ });
  for (let k = head; k < a.length - tail; k++) out.push({ kind: "del", text: a[k]!, oldNumber: oldNo++ });
  for (let k = head; k < b.length - tail; k++) out.push({ kind: "add", text: b[k]!, newNumber: newNo++ });
  for (let k = a.length - tail; k < a.length; k++) out.push({ kind: "same", text: a[k]!, oldNumber: oldNo++, newNumber: newNo++ });
  return out;
}

type Op = "same" | "del" | "add";

/**
 * Myers' greedy diff: time and memory grow with the number of edited lines, not with the file size, so a few edits in
 * a huge file stay cheap. Returns the operations in order, or `undefined` past `MAX_EDITS` edits.
 */
function myers(a: string[], b: string[]): Op[] | undefined {
  const n = a.length;
  const m = b.length;
  const limit = Math.min(n + m, MAX_EDITS);
  const offset = n + m + 1;
  const v = new Int32Array(2 * offset + 2);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(a, b, trace, d);
    }
  }
  return undefined;
}

function backtrack(a: string[], b: string[], trace: Int32Array[], last: number): Op[] {
  const ops: Op[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = last; d >= 0; d--) {
    const snap = trace[d]!;
    const at = (k: number): number => snap[k + d + 1]!;
    const k = x - y;
    const prevK = d === 0 ? 0 : k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : at(prevK);
    const prevY = d === 0 ? 0 : prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push("same");
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) {
        ops.push("add");
        y--;
      } else {
        ops.push("del");
        x--;
      }
    }
  }
  return ops.reverse();
}

/** Diff of a big changed block: the greedy diff when the edits are few, otherwise the block replaced. */
function largeDiff(a: string[], b: string[], head: number, tail: number, midA: string[], midB: string[]): DiffLine[] {
  const ops = myers(midA, midB);
  if (!ops) return replaceBlock(a, b, head, tail);
  const out: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (let k = 0; k < head; k++) out.push({ kind: "same", text: a[k]!, oldNumber: oldNo++, newNumber: newNo++ });
  let i = 0;
  let j = 0;
  for (const op of ops) {
    if (op === "same") out.push({ kind: "same", text: midA[i++]!, oldNumber: oldNo++, newNumber: newNo++ }), j++;
    else if (op === "del") out.push({ kind: "del", text: midA[i++]!, oldNumber: oldNo++ });
    else out.push({ kind: "add", text: midB[j++]!, newNumber: newNo++ });
  }
  for (let k = a.length - tail; k < a.length; k++) out.push({ kind: "same", text: a[k]!, oldNumber: oldNo++, newNumber: newNo++ });
  return out;
}

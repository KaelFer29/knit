/**
 * Which files an agent touched, read from the tool calls of its normalized timeline. Pure: the caller supplies the
 * entries and, for absolute paths, the directory the agent worked in.
 */

/** The part of a timeline entry this derivation reads. */
export interface ActivityEntry {
  kind: string;
  payload?: unknown;
}

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** Argument names that carry a file path: Claude's file tools, and Cursor's `args.path`. */
const FILE_ARGUMENTS = ["file_path", "notebook_path", "path"] as const;

/** Tools whose path is a directory to search or list, not a file the agent changed or read. */
const NON_FILE_TOOL = /glob|grep|search|find|list|^ls$/;

/**
 * Turns a path reported by a tool into a path relative to the worktree, or nothing when it cannot be trusted: it must
 * stay inside the root (absolute paths are re-rooted, relative ones must not climb with `..`), and carry no
 * backslashes or NUL bytes.
 */
export function confinePath(raw: unknown, root?: string): string | undefined {
  if (typeof raw !== "string" || raw.trim() === "" || raw.includes("\0") || raw.includes("\\")) return undefined;
  let path = raw;
  if (path.startsWith("/")) {
    if (root === undefined) return undefined;
    const base = root.replace(/\/+$/, "");
    if (!path.startsWith(`${base}/`)) return undefined;
    path = path.slice(base.length + 1);
  }
  const segments = path.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.length === 0 || segments.includes("..")) return undefined;
  return segments.join("/");
}

/**
 * The files of the tool calls that started in a timeline, each once, in first-seen order. Only `tool_started` entries
 * count: a call that started is a touch even when its result is missing. Search and listing tools are skipped.
 */
export function touchedPaths(entries: readonly ActivityEntry[], root?: string): string[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== "tool_started" || !isRecord(entry.payload)) continue;
    const tool = typeof entry.payload.tool === "string" ? entry.payload.tool : "";
    if (NON_FILE_TOOL.test(tool.replace(/ToolCall$/i, "").toLowerCase())) continue;
    const args = isRecord(entry.payload.args) ? entry.payload.args : {};
    const raw = FILE_ARGUMENTS.map((key) => args[key]).find((v) => typeof v === "string");
    const path = confinePath(raw, root);
    if (path !== undefined) seen.add(path);
  }
  return [...seen];
}

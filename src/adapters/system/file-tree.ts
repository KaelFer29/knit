import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative as relativePath, sep } from "node:path";
import { FileTreeError, type FileContent, type FileTree, type FileTreeEntry, type FileTreeListing } from "../../core/ports/file-tree.js";

/** Largest file whose text is returned. */
export const MAX_FILE_BYTES = 512 * 1024;
const BINARY_SNIFF_BYTES = 8000;
/** The version-control directory is not part of the explorer, in any letter case and at any depth. */
const HIDDEN = ".git";
const isHidden = (segment: string): boolean => segment.toLowerCase() === HIDDEN;

function segmentsOf(path: string): string[] {
  if (path.includes("\0") || path.includes("\\") || isAbsolute(path)) throw new FileTreeError("outside", "Path is outside the root");
  const segments = path.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.includes("..") || segments.some(isHidden)) throw new FileTreeError("outside", "Path is outside the root");
  return segments;
}

/** Resolves `path` under `root`, following symlinks, and proves the real location is still inside the real root. */
function confine(root: string, path: string): { real: string; relative: string } {
  const segments = segmentsOf(path);
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    throw new FileTreeError("not-found", "Root not found");
  }
  let real: string;
  try {
    real = realpathSync(join(realRoot, ...segments));
  } catch {
    throw new FileTreeError("not-found", "Path not found");
  }
  if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new FileTreeError("outside", "Path is outside the root");
  // A symlink inside the root can still lead into a version-control directory.
  if (relativePath(realRoot, real).split(sep).some(isHidden)) throw new FileTreeError("outside", "Path is outside the root");
  return { real, relative: segments.join("/") };
}

/** Read-only file explorer over the real file system. */
export class FsFileTree implements FileTree {
  constructor(private readonly maxBytes: number = MAX_FILE_BYTES) {}

  list(root: string, path: string): FileTreeListing {
    const { real, relative } = confine(root, path);
    if (!statSync(real).isDirectory()) throw new FileTreeError("not-directory", "Not a directory");
    const entries: FileTreeEntry[] = [];
    for (const name of readdirSync(real)) {
      if (isHidden(name)) continue;
      const entryPath = relative === "" ? name : `${relative}/${name}`;
      let stat;
      try {
        stat = lstatSync(join(real, name));
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) entries.push({ name, path: entryPath, kind: "symlink" });
      else if (stat.isDirectory()) entries.push({ name, path: entryPath, kind: "directory" });
      else if (stat.isFile()) entries.push({ name, path: entryPath, kind: "file", size: stat.size });
      else entries.push({ name, path: entryPath, kind: "other" });
    }
    entries.sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { path: relative, entries };
  }

  read(root: string, path: string): FileContent {
    const { real, relative } = confine(root, path);
    // Open without following a link and without blocking, then judge the open descriptor: a file swapped for a link
    // or a FIFO after the check above is refused instead of read (or waited on).
    let fd: number;
    try {
      fd = openSync(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch {
      throw new FileTreeError("outside", "Path is outside the root");
    }
    let read = 0;
    let stat;
    let buffer: Buffer;
    try {
      stat = fstatSync(fd);
      if (!stat.isFile()) throw new FileTreeError("not-file", "Not a regular file");
      if (stat.size > this.maxBytes) return { kind: "too-large", path: relative, size: stat.size, limit: this.maxBytes };
      buffer = Buffer.alloc(stat.size);
      while (read < buffer.length) {
        const n = readSync(fd, buffer, read, buffer.length - read, read);
        if (n === 0) break;
        read += n;
      }
    } finally {
      closeSync(fd);
    }
    const bytes = buffer.subarray(0, read);
    if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return { kind: "binary", path: relative, size: stat.size };
    return { kind: "text", path: relative, size: stat.size, text: bytes.toString("utf8") };
  }
}

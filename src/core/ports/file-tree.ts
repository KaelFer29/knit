/**
 * Port: read-only view of the files under one root directory (the target repository or a task worktree).
 *
 * Every path is relative to the root, uses `/` and may be empty (the root itself). An implementation confines every
 * access to the root: a path that leaves it (`..`, an absolute path, a symlink pointing out) fails with
 * `FileTreeError("outside")`, never yields a file. It never writes.
 */

export type FileTreeErrorCode = "outside" | "not-found" | "not-directory" | "not-file";

export class FileTreeError extends Error {
  constructor(
    readonly code: FileTreeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FileTreeError";
  }
}

export interface FileTreeEntry {
  name: string;
  /** Path relative to the root. */
  path: string;
  kind: "file" | "directory" | "symlink" | "other";
  /** Bytes; present for files only. */
  size?: number;
}

export interface FileTreeListing {
  path: string;
  /** Directories first, then files, each group by name. The `.git` entry is never listed. */
  entries: FileTreeEntry[];
}

export type FileContent =
  | { kind: "text"; path: string; size: number; text: string }
  | { kind: "binary"; path: string; size: number }
  | { kind: "too-large"; path: string; size: number; limit: number };

export interface FileTree {
  /** The entries of one directory. */
  list(root: string, path: string): FileTreeListing;
  /** The content of one file: text, or a marker for a binary or oversized file (never its bytes). */
  read(root: string, path: string): FileContent;
}

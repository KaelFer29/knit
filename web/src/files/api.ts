import { apiGet } from "../api/client";

export interface RootInfo {
  id: string;
  label: string;
}

export interface TreeEntry {
  name: string;
  path: string;
  kind: "file" | "directory" | "symlink" | "other";
  size?: number;
}

export type FileContent =
  | { kind: "text"; path: string; size: number; text: string }
  | { kind: "binary"; path: string; size: number }
  | { kind: "too-large"; path: string; size: number; limit: number };

/** What the explorer needs from the server. The container takes it as a prop so tests and demos can fake it. */
export interface FilesApi {
  roots(): Promise<RootInfo[]>;
  list(root: string, path: string): Promise<TreeEntry[]>;
  read(root: string, path: string): Promise<FileContent>;
}

const q = (root: string, path: string): string => `root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`;

/** The real API of `knit ui` for one run. */
export function httpFilesApi(runId: string): FilesApi {
  const base = `/api/runs/${encodeURIComponent(runId)}`;
  return {
    roots: async () => (await apiGet<{ roots: RootInfo[] }>(`${base}/roots`)).roots,
    list: async (root, path) => (await apiGet<{ entries: TreeEntry[] }>(`${base}/files?${q(root, path)}`)).entries,
    read: async (root, path) => await apiGet<FileContent>(`${base}/file?${q(root, path)}`),
  };
}

/** Human size: 512 B, 1.5 KB, 2.0 MB. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

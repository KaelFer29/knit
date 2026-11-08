import { useCallback, useEffect, useState } from "react";
import type { FilesApi, RootInfo, TreeEntry } from "../files/api";
import { FileExplorer, type TreeRow, type ViewerState } from "../organisms/FileExplorer";

interface Props {
  api: FilesApi;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : "Something went wrong");

/** Rows of the visible tree: a directory's children follow it while it is expanded. */
function visibleRows(children: Map<string, TreeEntry[]>, expanded: Set<string>, loading: Set<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (dir: string, depth: number): void => {
    for (const entry of children.get(dir) ?? []) {
      const open = entry.kind === "directory" && expanded.has(entry.path);
      rows.push({ entry, depth, expanded: open, loading: loading.has(entry.path) });
      if (open) walk(entry.path, depth + 1);
    }
  };
  walk("", 0);
  return rows;
}

/** Container: loads roots, directories and files on demand from the API and hands rows and content down. */
export function FilesView({ api }: Props) {
  const [roots, setRoots] = useState<RootInfo[]>([]);
  const [rootId, setRootId] = useState<string>();
  const [children, setChildren] = useState<Map<string, TreeEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string>();
  const [viewer, setViewer] = useState<ViewerState>({ state: "idle" });
  const [error, setError] = useState<string>();

  const loadDir = useCallback(
    async (root: string, path: string) => {
      setLoading((s) => new Set(s).add(path));
      try {
        const entries = await api.list(root, path);
        setChildren((m) => new Map(m).set(path, entries));
        setError(undefined);
      } catch (err) {
        setError(message(err));
        setExpanded((s) => {
          const next = new Set(s);
          next.delete(path);
          return next;
        });
      } finally {
        setLoading((s) => {
          const next = new Set(s);
          next.delete(path);
          return next;
        });
      }
    },
    [api],
  );

  useEffect(() => {
    let live = true;
    api.roots().then(
      (found) => {
        if (!live) return;
        setRoots(found);
        if (found[0]) setRootId(found[0].id);
      },
      (err) => live && setError(message(err)),
    );
    return () => {
      live = false;
    };
  }, [api]);

  useEffect(() => {
    if (!rootId) return;
    setChildren(new Map());
    setExpanded(new Set());
    setSelected(undefined);
    setViewer({ state: "idle" });
    void loadDir(rootId, "");
  }, [rootId, loadDir]);

  const onToggle = (entry: TreeEntry): void => {
    if (!rootId) return;
    if (expanded.has(entry.path)) {
      setExpanded((s) => {
        const next = new Set(s);
        next.delete(entry.path);
        return next;
      });
      return;
    }
    setExpanded((s) => new Set(s).add(entry.path));
    if (!children.has(entry.path)) void loadDir(rootId, entry.path);
  };

  const onOpen = (entry: TreeEntry): void => {
    if (!rootId) return;
    setSelected(entry.path);
    setViewer({ state: "loading", path: entry.path });
    api.read(rootId, entry.path).then(
      (content) => setViewer((v) => (v.state === "loading" && v.path === entry.path ? { state: "ready", content } : v)),
      (err) => setViewer((v) => (v.state === "loading" && v.path === entry.path ? { state: "error", path: entry.path, message: message(err) } : v)),
    );
  };

  return (
    <FileExplorer
      roots={roots}
      rootId={rootId ?? ""}
      rows={visibleRows(children, expanded, loading)}
      selectedPath={selected}
      viewer={viewer}
      error={error}
      onRoot={setRootId}
      onToggle={onToggle}
      onOpen={onOpen}
    />
  );
}

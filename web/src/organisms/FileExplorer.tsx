import { Chevron } from "../atoms/Chevron";
import { formatSize, type FileContent, type RootInfo, type TreeEntry } from "../files/api";
import "./FileExplorer.css";

export interface TreeRow {
  entry: TreeEntry;
  depth: number;
  expanded: boolean;
  loading: boolean;
}

export type ViewerState =
  | { state: "idle" }
  | { state: "loading"; path: string }
  | { state: "error"; path: string; message: string }
  | { state: "ready"; content: FileContent };

interface Props {
  roots: RootInfo[];
  rootId: string;
  rows: TreeRow[];
  selectedPath: string | undefined;
  viewer: ViewerState;
  /** A failure that concerns the whole tree (the roots or the top level could not be read). */
  error: string | undefined;
  onRoot: (id: string) => void;
  onToggle: (entry: TreeEntry) => void;
  onOpen: (entry: TreeEntry) => void;
}

function Viewer({ viewer }: { viewer: ViewerState }) {
  if (viewer.state === "idle") return <p className="explorer__hint">Select a file to read it. Nothing here can be changed.</p>;
  if (viewer.state === "loading") return <p className="explorer__hint">Loading {viewer.path}</p>;
  if (viewer.state === "error") return <p className="explorer__hint explorer__hint--error" role="alert">{viewer.message}</p>;
  const { content } = viewer;
  return (
    <>
      <header className="explorer__file-head">
        <span className="explorer__file-path">{content.path}</span>
        <span className="explorer__file-size">{formatSize(content.size)}</span>
      </header>
      {content.kind === "text" ? (
        // Plain text node: file contents are untrusted and never interpreted as HTML or Markdown.
        <pre className="explorer__code" tabIndex={0} aria-label={`Contents of ${content.path}`}>{content.text}</pre>
      ) : content.kind === "binary" ? (
        <p className="explorer__hint">Binary file, not shown.</p>
      ) : (
        <p className="explorer__hint">Too large to show (limit {formatSize(content.limit)}).</p>
      )}
    </>
  );
}

/** Presentational: a root switcher, the tree of the current root and the content of the selected file. */
export function FileExplorer({ roots, rootId, rows, selectedPath, viewer, error, onRoot, onToggle, onOpen }: Props) {
  return (
    <section className="explorer" aria-label="File explorer">
      <aside className="explorer__side">
        <label className="explorer__root">
          <span className="explorer__root-label">Root</span>
          <select value={rootId} onChange={(e) => onRoot(e.target.value)}>
            {roots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        {error ? <p className="explorer__hint explorer__hint--error" role="alert">{error}</p> : null}
        <ul className="explorer__tree" role="tree" aria-label="Files">
          {rows.map(({ entry, depth, expanded, loading }) => {
            const isDir = entry.kind === "directory";
            const selectable = isDir || entry.kind === "file";
            return (
              <li key={entry.path} role="none">
                <button
                  type="button"
                  role="treeitem"
                  className="explorer__row"
                  style={{ paddingInlineStart: `calc(var(--space-2) + ${depth} * var(--space-4))` }}
                  aria-level={depth + 1}
                  aria-expanded={isDir ? expanded : undefined}
                  aria-selected={entry.path === selectedPath}
                  aria-disabled={!selectable}
                  disabled={!selectable}
                  onClick={() => (isDir ? onToggle(entry) : onOpen(entry))}
                >
                  <span className="explorer__caret" aria-hidden="true" data-open={isDir && expanded}>
                    {isDir ? <Chevron /> : null}
                  </span>
                  <span className="explorer__name" data-kind={entry.kind}>
                    {entry.name}
                    {entry.kind === "symlink" ? " (link)" : ""}
                  </span>
                  {loading ? <span className="explorer__meta">loading</span> : entry.size !== undefined ? <span className="explorer__meta">{formatSize(entry.size)}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <div className="explorer__content" aria-live="polite">
        <Viewer viewer={viewer} />
      </div>
    </section>
  );
}

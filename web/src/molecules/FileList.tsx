import "../organisms/detail.css";

interface Props {
  /** Accessible name of the list. */
  label: string;
  paths: string[];
  /** True when more files changed than `paths` lists. */
  moreFiles?: boolean;
  /** Shown instead of the list when there is nothing to list. */
  empty: string;
}

/** Presentational: the files an agent or a worktree touched, one path per line. Paths are agent output: rendered as text. */
export function FileList({ label, paths, moreFiles = false, empty }: Props) {
  if (paths.length === 0 && !moreFiles) return <p className="detail-note">{empty}</p>;
  return (
    <>
      {paths.length === 0 ? null : (
        <ul className="detail-list" aria-label={label}>
          {paths.map((path) => (
            <li key={path}>
              <code className="detail-code">{path}</code>
            </li>
          ))}
        </ul>
      )}
      {moreFiles ? <p className="detail-note">More files changed than shown.</p> : null}
    </>
  );
}

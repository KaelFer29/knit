import { parsePatch } from "../detail/patch";
import type { DiffFile, TaskDiffData } from "../detail/types";
import { shortSha } from "../flow/format";
import { Disclosure } from "../molecules/Disclosure";
import "./detail.css";

interface Props {
  diff: TaskDiffData;
}

const STATUS_LABEL = { added: "Added", modified: "Modified", deleted: "Deleted" } as const;

function Counts({ file }: { file: DiffFile }) {
  if (file.binary) return <>binary</>;
  return (
    <>
      <span className="diff__add">+{file.additions ?? 0}</span> <span className="diff__del">−{file.deletions ?? 0}</span>
    </>
  );
}

function Patch({ file }: { file: DiffFile }) {
  if (file.patch === undefined) {
    return <p className="detail-note">{file.binary ? "Binary file: no text to show." : file.truncated ? "This change is too large to show here." : "No text changes."}</p>;
  }
  return (
    <table className="patch" aria-label={`Changes in ${file.path}`}>
      <tbody>
        {parsePatch(file.patch).map((line, i) => (
          <tr key={i} className="patch__row" data-kind={line.kind}>
            <td className="patch__no" aria-hidden="true">
              {line.oldNo ?? ""}
            </td>
            <td className="patch__no" aria-hidden="true">
              {line.newNo ?? ""}
            </td>
            <td className="patch__code">
              <span className="patch__sign" aria-hidden="true">
                {line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}
              </span>
              {line.text}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** What a task changed: its files with counts, each expandable to its hunks. */
export function DiffView({ diff }: Props) {
  if (diff.files.length === 0) return <p className="detail-note">This task changed no files.</p>;
  const range = diff.commitSha === undefined ? `${shortSha(diff.startSha)} to the worktree` : `${shortSha(diff.startSha)} to ${shortSha(diff.commitSha)}`;
  return (
    <div className="diff">
      <p className="detail-note">
        {diff.files.length} {diff.files.length === 1 ? "file" : "files"}, <code>{range}</code>
        {diff.moreFiles ? ". More files changed than are listed." : ""}
      </p>
      {diff.files.map((file) => (
        <Disclosure
          key={file.path}
          title={
            <span className="diff__file">
              <span className="diff__status" data-status={file.status}>
                {STATUS_LABEL[file.status]}
              </span>
              <code>{file.path}</code>
            </span>
          }
          meta={<Counts file={file} />}
        >
          <Patch file={file} />
        </Disclosure>
      ))}
    </div>
  );
}

import { useMemo } from "react";
import { draftPullRequest, openPullRequest, undoBranch } from "../../../branches/api";
import { useBranches } from "../../../branches/useBranches";
import { BranchCard, type BranchActions } from "../../../organisms/BranchCard";
import "./BranchesView.css";

/**
 * The branches Cursor created for a run: what each holds and what can be done with it (undo it, or open its pull
 * request). Container: it reads the branches, runs the actions and reads again after each one.
 */
export function BranchesView({ runId, pollMs }: { runId: string; pollMs?: number }) {
  const { listing, error, reload } = useBranches(runId, pollMs);
  const actions = useMemo<BranchActions>(
    () => ({
      undo: (taskId, mode) => undoBranch(runId, taskId, mode),
      draft: (taskId) => draftPullRequest(runId, taskId),
      open: (taskId, title, body) => openPullRequest(runId, taskId, title, body),
    }),
    [runId],
  );
  if (listing === undefined) {
    return error === undefined ? (
      <p className="detail-note" role="status">
        Reading the branches…
      </p>
    ) : (
      <p className="detail-note" role="alert">
        Could not read the branches: {error}
      </p>
    );
  }
  if (listing.branches.length === 0) return <p className="detail-note">No branches yet. Cursor creates one for each task it starts.</p>;
  return (
    <div className="branches">
      <p className="branches__note">
        Pull requests go into <code>{listing.base}</code>, or into the branch of the task they depend on. Nothing is pushed until you press the button.
      </p>
      {error === undefined ? null : (
        <p className="detail-note" role="status">
          Could not refresh: {error}
        </p>
      )}
      {listing.branches.map((b) => (
        <BranchCard key={b.taskId} branch={b} actions={actions} onChanged={reload} />
      ))}
    </div>
  );
}

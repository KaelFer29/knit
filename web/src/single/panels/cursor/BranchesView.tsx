import { useMemo } from "react";
import type { BranchView } from "../../../branches/types";
import { useList } from "../../../lists/useList";
import { ListToolbar } from "../../../molecules/ListToolbar";
import { Pager } from "../../../molecules/Pager";
import { checkoutBranch, draftPullRequest, fetchRemoteBranches, openPullRequest, undoBranch } from "../../../branches/api";
import { useBranches } from "../../../branches/useBranches";
import { BranchCard, type BranchActions } from "../../../organisms/BranchCard";
import "./BranchesView.css";

const PAGE_SIZE = 6;
const searchable = (b: BranchView): string[] => [b.taskId, b.title, b.branch];

/**
 * The branches Cursor created for a run: what each holds and what can be done with it (undo it, or open its pull
 * request). Container: it reads the branches, runs the actions and reads again after each one.
 */
export function BranchesView({ runId, pollMs }: { runId: string; pollMs?: number }) {
  const { listing, error, reload } = useBranches(runId, pollMs);
  const actions = useMemo<BranchActions>(
    () => ({
      remote: () => fetchRemoteBranches(runId),
      checkout: (taskId) => checkoutBranch(runId, taskId),
      undo: (taskId, mode) => undoBranch(runId, taskId, mode),
      draft: (taskId, how) => draftPullRequest(runId, taskId, how),
      open: (taskId, title, body, into) => openPullRequest(runId, taskId, title, body, into),
    }),
    [runId],
  );
  const list = useList({ items: listing?.branches ?? [], pageSize: PAGE_SIZE, fields: searchable });
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
      {error === undefined ? null : (
        <p className="detail-note" role="status">
          Could not refresh: {error}
        </p>
      )}
      {listing.branches.length > 1 ? <ListToolbar label="Search branches" query={list.query} onQuery={list.setQuery} summary={list.narrowed ? `${list.matching} of ${listing.branches.length} branches` : undefined} /> : null}
      {list.view.total === 0 ? <p className="detail-note">No branch matches this search.</p> : null}
      {list.view.items.map((b) => (
        <BranchCard key={b.taskId} runId={runId} branch={b} actions={actions} onChanged={reload} defaultOpen={listing.branches.length === 1} />
      ))}
      <Pager page={list.view} onPage={list.setPage} noun="branches" />
    </div>
  );
}

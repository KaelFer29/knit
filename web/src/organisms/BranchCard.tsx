import { useId, useState } from "react";
import { ApiError } from "../api/client";
import { StatusBadge } from "../atoms/StatusBadge";
import type { BranchView, PrDraft, PrResult, UndoMode, UndoResult } from "../branches/types";
import { draftKey, draftOnce, forgetDraft, loadDraft, saveDraft } from "../branches/draftCache";
import { Popover } from "../molecules/Popover";
import "./BranchCard.css";

export interface BranchActions {
  undo: (taskId: string, mode: UndoMode) => Promise<UndoResult>;
  draft: (taskId: string) => Promise<PrDraft>;
  open: (taskId: string, title: string, body: string) => Promise<PrResult>;
}

const UNDO: Record<UndoMode, { menu: string; hint: string; title: (branch: string) => string; confirm: string; done: (branch: string, taskId: string) => string }> = {
  revert: {
    menu: "Revert (keep the history)",
    hint: "Adds a commit that undoes the task",
    title: (b) => `Revert ${b}`,
    confirm: "Revert the changes",
    done: (b) => `Reverted ${b}: a commit was added that restores the code to how it was before the task.`,
  },
  reset: {
    menu: "Reset to the start",
    hint: "Takes the branch back; its commits leave it",
    title: (b) => `Reset ${b} to the start`,
    confirm: "Move back to the start",
    done: (b, t) => `${b} is back at the start of ${t}.`,
  },
  delete: {
    menu: "Delete branch",
    hint: "Removes the branch and its worktree",
    title: (b) => `Delete branch ${b}`,
    confirm: "Delete branch",
    done: (b) => `Deleted ${b} and its worktree.`,
  },
};

const messageOf = (err: unknown): string => (err instanceof ApiError || err instanceof Error ? err.message : String(err));
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
const DRAFT_MODEL = "composer-2.5-fast";

type Panel = { kind: "undo"; mode: UndoMode } | { kind: "pr" } | undefined;

/**
 * One branch Cursor created: its commits and where it is, and what can be done with it. Undoing asks first and says
 * exactly what it will do; a pull request is drafted by a cheap model and edited before anything is pushed. The card
 * only renders and holds the state of its own forms; the actions come from the container.
 */
export function BranchCard({ runId, branch: b, actions, onChanged }: { runId: string; branch: BranchView; actions: BranchActions; onChanged: () => void }) {
  const [panel, setPanel] = useState<Panel>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<{ text: string; url?: string }>();
  const [draft, setDraft] = useState<{ state: "writing" | "ready" | "failed"; title: string; body: string; model: string; saved: boolean }>({ state: "writing", title: b.title, body: "", model: DRAFT_MODEL, saved: false });
  const key = draftKey(runId, b.taskId, b.state.head);
  const titleId = useId();
  const bodyId = useId();

  const close = (): void => {
    setPanel(undefined);
    setError(undefined);
  };

  const confirmUndo = async (mode: UndoMode): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await actions.undo(b.taskId, mode);
      setPanel(undefined);
      setResult({ text: UNDO[mode].done(b.branch, b.taskId) });
      onChanged();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  /** Asks the model, or joins the call already running for this state of the branch; the answer is saved. */
  const askModel = (): void => {
    setError(undefined);
    setDraft({ state: "writing", title: b.title, body: "", model: DRAFT_MODEL, saved: false });
    draftOnce(key, () => actions.draft(b.taskId)).then(
      (d) => setDraft({ state: "ready", title: d.title || b.title, body: d.body, model: d.model, saved: false }),
      (err: unknown) => {
        setDraft((current) => ({ ...current, state: "failed" }));
        setError(messageOf(err));
      },
    );
  };

  /** Opens the form. A text already written for this commit (by the model or by the person) is shown as it was; the model is not asked again. */
  const startPr = (): void => {
    setResult(undefined);
    setError(undefined);
    setPanel({ kind: "pr" });
    const saved = loadDraft(key);
    if (saved) setDraft({ state: "ready", title: saved.title, body: saved.body, model: saved.model, saved: true });
    else askModel();
  };

  const edit = (next: { title?: string; body?: string }): void => {
    const updated = { ...draft, ...next };
    setDraft(updated);
    if (updated.state === "ready") saveDraft(key, { title: updated.title, body: updated.body, model: updated.model });
  };

  const sendPr = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const done = await actions.open(b.taskId, draft.title.trim(), draft.body);
      setPanel(undefined);
      forgetDraft(key);
      setResult({ text: `Opened ${done.url}`, url: done.url });
      onChanged();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const { state } = b;
  const prReason = b.pr.ok ? undefined : b.pr.reason;

  return (
    <section className="branch" aria-label={`Branch ${b.branch}`} data-status={b.status}>
      <header className="branch__head">
        <span className="branch__id">{b.taskId}</span>
        <span className="branch__title">{b.title}</span>
        <StatusBadge state={b.status === "passed" ? "delivered" : b.status === "failed" ? "failed" : "running"} />
      </header>
      <p className="branch__name">
        <span aria-hidden="true">⎇ </span>
        {b.branch}
      </p>
      <ul className="branch__chips" aria-label="State of the branch">
        <li>{plural(state.ahead.length, "commit")}</li>
        <li data-tone={state.pushed ? "ok" : undefined}>{state.pushed ? "On origin" : "Local only"}</li>
        <li>{state.hasWorktree ? "Has a worktree" : "No worktree"}</li>
        {state.dirty ? <li data-tone="warn">Uncommitted changes</li> : null}
        {!state.exists ? <li data-tone="warn">Branch is gone</li> : null}
        {b.prUrl ? (
          <li data-tone="ok">
            <a href={b.prUrl} target="_blank" rel="noopener noreferrer">
              Pull request ↗
            </a>
          </li>
        ) : null}
      </ul>
      {state.ahead.length > 0 ? (
        <ol className="branch__commits" aria-label="Commits of the task">
          {state.ahead.slice(0, 5).map((c) => (
            <li key={c.sha}>
              <code>{c.sha.slice(0, 7)}</code> {c.subject}
            </li>
          ))}
          {state.ahead.length > 5 ? <li className="branch__more">and {state.ahead.length - 5} more</li> : null}
        </ol>
      ) : null}

      <div className="branch__actions">
        {b.prUrl ? null : (
          <button type="button" className="branch__primary" disabled={!b.pr.ok || busy || panel?.kind === "pr"} onClick={startPr}>
            Open pull request
          </button>
        )}
        <Popover
          label="Undo"
          direction="down"
          align="start"
          triggerClassName="branch__undo"
          trigger={
            <>
              Undo <span aria-hidden="true">▾</span>
            </>
          }
        >
          {({ close: closeMenu }) => (
            <div role="menu" className="branch__menu" aria-label="Ways to undo">
              {(Object.keys(UNDO) as UndoMode[]).map((mode) => {
                const decision = b.undo[mode];
                return (
                  <button
                    key={mode}
                    type="button"
                    role="menuitem"
                    className="branch__item"
                    aria-disabled={!decision.ok}
                    onClick={() => {
                      if (!decision.ok) return;
                      closeMenu();
                      setResult(undefined);
                      setError(undefined);
                      setPanel({ kind: "undo", mode });
                    }}
                  >
                    <span className="branch__item-label">{UNDO[mode].menu}</span>
                    <span className="branch__item-hint">{decision.ok ? UNDO[mode].hint : decision.reason}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Popover>
      </div>
      {prReason !== undefined && !b.prUrl ? <p className="branch__why">{prReason}</p> : null}

      {panel?.kind === "undo" ? (
        <div className="branch__panel branch__panel--danger" role="alertdialog" aria-label={UNDO[panel.mode].title(b.branch)}>
          <p className="branch__panel-title">{UNDO[panel.mode].title(b.branch)}</p>
          {b.undo[panel.mode].ok ? (
            <ul className="branch__effects">
              {(b.undo[panel.mode] as { effects: string[] }).effects.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
          {error ? (
            <p className="branch__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="branch__row">
            <button type="button" className="branch__danger" disabled={busy} onClick={() => void confirmUndo(panel.mode)}>
              {busy ? "Working…" : UNDO[panel.mode].confirm}
            </button>
            <button type="button" className="branch__ghost" disabled={busy} onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {panel?.kind === "pr" ? (
        <form
          className="branch__panel"
          aria-label={`Pull request for ${b.branch}`}
          aria-busy={draft.state === "writing"}
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.title.trim() !== "" && !busy && draft.state !== "writing") void sendPr();
          }}
        >
          {draft.state === "writing" ? (
            <p className="branch__panel-note branch__writing" role="status">
              <span className="branch__spinner" role="progressbar" aria-label={`Writing the description with ${draft.model}`} />
              Writing the description with {draft.model}… this takes a few seconds.
            </p>
          ) : (
            <p className="branch__panel-note">
              {draft.state === "failed" ? "Write the description yourself, or ask the model again." : draft.saved ? `Saved description (written by ${draft.model}). Edit it, or write it again.` : `Description written by ${draft.model}. Edit it before sending.`}{" "}
              <button type="button" className="branch__link" disabled={busy} onClick={askModel}>
                Write it again
              </button>
            </p>
          )}
          <label className="branch__label" htmlFor={titleId}>
            Title
          </label>
          <input id={titleId} className="branch__field" value={draft.title} maxLength={200} disabled={draft.state === "writing"} onChange={(e) => edit({ title: e.target.value })} />
          <label className="branch__label" htmlFor={bodyId}>
            Description
          </label>
          <textarea id={bodyId} className="branch__field branch__body" rows={8} value={draft.body} disabled={draft.state === "writing"} placeholder={draft.state === "writing" ? "…" : undefined} onChange={(e) => edit({ body: e.target.value })} />
          {b.pr.ok ? (
            <ul className="branch__effects">
              {b.pr.effects.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
          {error ? (
            <p className="branch__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="branch__row">
            <button type="submit" className="branch__primary" disabled={busy || draft.state === "writing" || draft.title.trim() === ""}>
              {busy ? "Working…" : "Push and open pull request"}
            </button>
            <button type="button" className="branch__ghost" disabled={busy} onClick={close}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {result ? (
        <p className="branch__result" role="status">
          {result.url ? (
            <>
              Opened{" "}
              <a href={result.url} target="_blank" rel="noopener noreferrer">
                {result.url}
              </a>
            </>
          ) : (
            result.text
          )}
        </p>
      ) : null}
    </section>
  );
}

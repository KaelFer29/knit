import { useEffect, useId, useState } from "react";
import { ApiError } from "../api/client";
import { Chevron } from "../atoms/Chevron";
import { StatusBadge } from "../atoms/StatusBadge";
import type { BranchView, CheckoutResult, PrDraft, PrResult, UndoMode, UndoResult } from "../branches/types";
import { draftKey, draftOnce, forgetDraft, loadDraft, saveDraft } from "../branches/draftCache";
import { Popover } from "../molecules/Popover";
import "./BranchCard.css";

export interface BranchActions {
  /** The branches origin has now, asked each time the pull request form opens. */
  remote: () => Promise<string[]>;
  /** Switches the user's repository to the branch to test it. */
  checkout: (taskId: string) => Promise<CheckoutResult>;
  undo: (taskId: string, mode: UndoMode) => Promise<UndoResult>;
  draft: (taskId: string, how: "template" | "model") => Promise<PrDraft>;
  open: (taskId: string, title: string, body: string, into?: string) => Promise<PrResult>;
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
/** What the server calls a description built from the task, with no model. */
const TEMPLATE = "template";

type Panel = { kind: "undo"; mode: UndoMode } | { kind: "pr" } | { kind: "checkout" } | undefined;

/**
 * One branch Cursor created: its commits and where it is, and what can be done with it. Undoing asks first and says
 * exactly what it will do; a pull request is drafted by a cheap model and edited before anything is pushed. The card
 * only renders and holds the state of its own forms; the actions come from the container.
 */
/** How long the notice of a finished checkout stays in the tag row. */
export const FLASH_MS = 3000;

export function BranchCard({ runId, branch: b, actions, onChanged, defaultOpen = false, flashMs = FLASH_MS }: { runId: string; branch: BranchView; actions: BranchActions; onChanged: () => void; defaultOpen?: boolean; flashMs?: number }) {
  const [open, setOpen] = useState(defaultOpen);
  /** A short notice at the end of the state tags; it goes away by itself. */
  const [flash, setFlash] = useState<{ text: string; key: number }>();
  useEffect(() => {
    if (flash === undefined) return;
    const timer = window.setTimeout(() => setFlash(undefined), flashMs);
    return () => window.clearTimeout(timer);
  }, [flash, flashMs]);
  const sectionId = useId();
  const [panel, setPanel] = useState<Panel>();
  /** The branch typed in the form; undefined until the person edits it, so the recommended one stays the default. */
  const [into, setInto] = useState<string>();
  const [remote, setRemote] = useState<{ state: "loading" } | { state: "ready"; names: string[] } | { state: "failed"; message: string }>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<{ text: string; url?: string }>();
  const [draft, setDraft] = useState<{ state: "writing" | "ready" | "failed"; title: string; body: string; model: string; saved: boolean }>({ state: "writing", title: b.title, body: "", model: TEMPLATE, saved: false });
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

  const confirmCheckout = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await actions.checkout(b.taskId);
      setPanel(undefined);
      setFlash({ text: "Repository switched", key: Date.now() });
      onChanged();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Gets the description: built from the task (no model, no tokens), or written by the model when the person asks.
   * Joins the call already running for this state of the branch; the answer is saved.
   */
  const askDraft = (how: "template" | "model"): void => {
    setError(undefined);
    setDraft({ state: "writing", title: b.title, body: "", model: how === "template" ? TEMPLATE : DRAFT_MODEL, saved: false });
    draftOnce(key, () => actions.draft(b.taskId, how), how).then(
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
    setInto(undefined);
    setRemote({ state: "loading" });
    actions.remote().then(
      (names) => setRemote({ state: "ready", names }),
      (err: unknown) => setRemote({ state: "failed", message: messageOf(err) }),
    );
    setPanel({ kind: "pr" });
    const saved = loadDraft(key);
    if (saved) setDraft({ state: "ready", title: saved.title, body: saved.body, model: saved.model, saved: true });
    else askDraft("template");
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
      const target = baseValue.trim();
      const done = await actions.open(b.taskId, draft.title.trim(), draft.body, target === recommended ? undefined : target);
      setPanel(undefined);
      forgetDraft(key);
      setResult({ text: "", url: done.url });
      onChanged();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const { state } = b;
  const prReason = b.pr.ok ? undefined : b.pr.reason;
  const recommended = b.pr.ok ? b.pr.base : "";
  const head = b.pr.ok ? b.pr.head : b.branch;
  // Where a pull request can go: what origin has right now (GitHub needs the base there); the suggestions when origin cannot be asked.
  const candidates = remote.state === "ready" ? remote.names.filter((n) => n !== head) : remote.state === "failed" ? (b.pr.ok ? b.pr.options : []) : [];
  const recommendedThere = candidates.includes(recommended);
  const baseValue = into ?? (recommendedThere ? recommended : "");
  const intoId = useId();

  return (
    <section className="branch" aria-label={`Branch ${b.branch}`} data-status={b.status}>
      <button type="button" className="branch__toggle" aria-expanded={open} aria-controls={open ? sectionId : undefined} onClick={() => setOpen((v) => !v)} title={b.title}>
        <span className="branch__id">{b.taskId}</span>
        <span className="branch__name">
          <span aria-hidden="true">⎇ </span>
          {b.branch}
        </span>
        {b.prState?.state === "merged" ? (
          <span className="branch__pr" data-state="merged">
            Merged into {b.prState.base}
          </span>
        ) : b.prState?.state === "closed" ? (
          <span className="branch__pr" data-state="closed">
            Closed without merging
          </span>
        ) : null}
        {b.prState !== undefined && b.prState.state !== "open" && (b.prState.newCommits ?? 0) > 0 ? (
          <span className="branch__pr" data-state="new" title="Commits made after the pull request ended: they are not in the base branch">
            {b.prState.newCommits} new {b.prState.newCommits === 1 ? "commit" : "commits"}
          </span>
        ) : null}
        <StatusBadge state={b.status === "passed" ? "delivered" : b.status === "failed" ? "failed" : "running"} />
        <Chevron />
      </button>
      {open ? (
        <div className="branch__body-wrap" id={sectionId}>
      <ul className="branch__chips" aria-label="State of the branch" style={{ "--flash-ms": `${flashMs}ms` } as React.CSSProperties}>
        <li>{plural(state.ahead.length, "commit")}</li>
        <li data-tone={state.pushed ? "ok" : undefined}>{state.pushed ? "On origin" : "Local only"}</li>
        <li>{state.hasWorktree ? "Has a worktree" : "No worktree"}</li>
        {state.dirty ? <li data-tone="warn">Uncommitted changes</li> : null}
        {!state.exists ? <li data-tone="warn">Branch is gone</li> : null}
        {b.prUrl ? (
          <li data-tone={b.prState?.state === "merged" ? "merged" : b.prState?.state === "closed" ? "warn" : "ok"}>
            <a href={b.prUrl} target="_blank" rel="noopener noreferrer">
              {b.prState?.state === "merged" ? "Merged ↗" : b.prState?.state === "closed" ? "Closed ↗" : "Pull request ↗"}
            </a>
          </li>
        ) : null}
              {flash === undefined ? null : (
          <li key={flash.key} className="branch__flash" data-tone="ok">
            <span role="status">
              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <path d="m3.5 8.5 3 3 6-7" />
              </svg>{" "}
              {flash.text}
            </span>
          </li>
        )}
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
        {b.prUrl && !b.pr.ok ? null : (
          <button type="button" className="branch__primary" disabled={!b.pr.ok || busy || panel?.kind === "pr"} onClick={startPr}>
            Open pull request
          </button>
        )}
        <button
          type="button"
          className="branch__ghost"
          disabled={!b.checkout.ok || busy || panel?.kind === "checkout"}
          title={b.checkout.ok ? "Switch your repository to this branch to test it" : b.checkout.reason}
          onClick={() => {
            setResult(undefined);
            setError(undefined);
            setPanel({ kind: "checkout" });
          }}
        >
          Test this branch
        </button>
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
      {!b.checkout.ok && b.checkout.reason !== prReason ? <p className="branch__why">{b.checkout.reason}</p> : null}

      {panel?.kind === "checkout" && b.checkout.ok ? (
        <div className="branch__panel" role="alertdialog" aria-label={`Test ${b.branch} in your repository`}>
          <p className="branch__panel-title">Test {b.branch} in your repository</p>
          <ul className="branch__effects">
            {b.checkout.effects.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          {error ? (
            <p className="branch__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="branch__row">
            <button type="button" className="branch__primary" disabled={busy} onClick={() => void confirmCheckout()}>
              {busy ? "Working…" : "Switch my repository"}
            </button>
            <button type="button" className="branch__ghost" disabled={busy} onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

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
            if (draft.title.trim() !== "" && baseValue.trim() !== "" && !busy && draft.state !== "writing") void sendPr();
          }}
        >
          {draft.state === "writing" ? (
            <p className="branch__panel-note branch__writing" role="status">
              <span className="branch__spinner" role="progressbar" aria-label={draft.model === TEMPLATE ? "Preparing the description" : `Writing the description with ${draft.model}`} />
              {draft.model === TEMPLATE ? "Preparing the description…" : `Writing the description with ${draft.model}… this takes a few seconds.`}
            </p>
          ) : (
            <p className="branch__panel-note">
              {draft.state === "failed"
                ? "Write the description yourself, or ask the model."
                : draft.model === TEMPLATE
                  ? "Description built from the task: summary, specs, commits and files. Edit it before sending."
                  : draft.saved
                    ? `Saved description (written by ${draft.model}). Edit it, or write it again.`
                    : `Description written by ${draft.model}. Edit it before sending.`}{" "}
              {draft.model === TEMPLATE && draft.state === "ready" ? (
                <button type="button" className="branch__link" disabled={busy} onClick={() => askDraft("model")}>
                  Improve with the model
                </button>
              ) : (
                <button type="button" className="branch__link" disabled={busy} onClick={() => askDraft("model")}>
                  Write it again
                </button>
              )}
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
            <>
              <label className="branch__label" htmlFor={intoId}>
                Into branch
              </label>
              <select id={intoId} className="branch__field" value={baseValue} disabled={busy || remote.state === "loading"} onChange={(e) => setInto(e.target.value)}>
                {remote.state === "loading" ? <option value="">Reading the branches of origin…</option> : null}
                {remote.state !== "loading" && !recommendedThere ? (
                  <option value="" disabled>
                    Choose a branch…
                  </option>
                ) : null}
                {recommendedThere ? <option value={recommended}>{recommended} (recommended)</option> : null}
                {candidates
                  .filter((n) => n !== recommended)
                  .map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
              </select>
              {remote.state === "failed" ? <p className="branch__panel-note">Could not read the branches of origin: {remote.message}</p> : null}
              {remote.state === "ready" && !recommendedThere ? <p className="branch__panel-note">The recommended branch {recommended} is not on origin. Choose where to open the pull request.</p> : null}
              <ul className="branch__effects">
                <li>{b.pr.effects[0]}</li>
                <li>{`Opens a pull request from ${b.pr.head} into ${baseValue.trim() === "" ? "…" : baseValue.trim()}.`}</li>
              </ul>
            </>
          ) : null}
          {error ? (
            <p className="branch__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="branch__row">
            <button type="submit" className="branch__primary" disabled={busy || draft.state === "writing" || draft.title.trim() === "" || baseValue.trim() === ""}>
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
            <a href={result.url} target="_blank" rel="noopener noreferrer">
              Pull request ↗
            </a>
          ) : (
            result.text
          )}
        </p>
      ) : null}
        </div>
      ) : null}
    </section>
  );
}

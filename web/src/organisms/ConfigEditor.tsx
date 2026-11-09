import { lazy, Suspense, useRef } from "react";
import type { DiffItem } from "../config/diff";
import type { ConfigFileEntry } from "../config/api";
import type { EditorLanguage } from "../config/CodeEditor";
import { DiffView } from "../molecules/DiffView";
import "./ConfigEditor.css";

// CodeMirror is the heaviest dependency of the app and only this panel needs it, so it loads on first use.
const CodeEditor = lazy(() => import("../config/CodeEditor"));

export interface ConfigEditorProps {
  file: ConfigFileEntry;
  /** Changes with every read of a file; a new key starts a new document and a new undo history. */
  docKey: string;
  /** Text as it was read; the editor owns the draft after that. */
  initialDoc: string;
  language: EditorLanguage;
  step: "edit" | "review";
  /** Diff of the draft against the version that was read; shown in the review step. */
  diff: DiffItem[];
  /** Why the draft cannot be reviewed (for example invalid JSON); undefined when it can. */
  problem: string | undefined;
  changed: boolean;
  saving: boolean;
  /** Result of the last save, or a failure; a failure that can be fixed by reloading says so. */
  notice: { kind: "saved" | "error"; text: string; canReload?: boolean } | undefined;
  onDraft: (text: string) => void;
  onReview: () => void;
  onBack: () => void;
  onSave: () => void;
  onReload: () => void;
}

/**
 * One file: a single editor instance that stays mounted through edit and review (so Ctrl+Z keeps working after a
 * review), the diff below it while reviewing, and the outcome of the last save. Presentational.
 */
export function ConfigEditor(props: ConfigEditorProps) {
  const { file, step, notice } = props;
  const section = useRef<HTMLElement>(null);
  const reviewing = step === "review";

  return (
    <section ref={section} tabIndex={-1} className="config-editor" aria-label={`Editing ${file.label}`}>
      <header className="config-editor__header">
        <div className="config-editor__heading">
          <h3 className="config-editor__title">{file.label}</h3>
          <p className="config-editor__path">
            <span className="config-editor__scope">{file.scope}</span>
            {file.displayPath}
            {file.exists ? "" : " · does not exist yet, saving creates it"}
          </p>
        </div>
        <div className="config-editor__actions">
          {reviewing ? (
            <>
              <button type="button" className="config-editor__button" onClick={props.onBack} disabled={props.saving}>
                Keep editing
              </button>
              <button type="button" className="config-editor__button config-editor__button--primary" onClick={props.onSave} disabled={props.saving}>
                {props.saving ? "Saving…" : "Save"}
              </button>
            </>
          ) : (
            <button type="button" className="config-editor__button config-editor__button--primary" disabled={!props.changed || props.problem !== undefined} onClick={props.onReview}>
              Review changes
            </button>
          )}
        </div>
      </header>

      {props.problem ? (
        <p className="config-editor__notice config-editor__notice--error" role="alert">
          {props.problem}
        </p>
      ) : null}
      {notice?.kind === "error" ? (
        <p className="config-editor__notice config-editor__notice--error" role="alert">
          {notice.text}
          {notice.canReload ? (
            <button type="button" className="config-editor__link" onClick={props.onReload}>
              Reload the file
            </button>
          ) : null}
        </p>
      ) : null}
      {notice?.kind === "saved" ? (
        <p className="config-editor__notice config-editor__notice--ok" role="status">
          {notice.text}
        </p>
      ) : null}

      <Suspense fallback={<p className="config-editor__hint">Loading the editor…</p>}>
        <CodeEditor
          docKey={props.docKey}
          initialDoc={props.initialDoc}
          language={props.language}
          label={`Contents of ${file.label}`}
          readOnly={reviewing}
          onChange={props.onDraft}
          // With unsaved edits, Escape only leaves the editor (so the panel is not closed by accident); Escape again closes it.
          onEscape={() => {
            if (!props.changed) return false;
            section.current?.focus();
            return true;
          }}
        />
      </Suspense>
      <p className="config-editor__hint">
        Ctrl+Z undoes, Ctrl+Shift+Z or Ctrl+Y redoes. Tab leaves the editor; Escape leaves it too when there are unsaved edits, and closes the panel otherwise.
      </p>

      {reviewing ? (
        <div className="config-editor__review">
          <p className="config-editor__hint">Review what will change. The current version is backed up before it is replaced.</p>
          <DiffView items={props.diff} />
        </div>
      ) : null}
    </section>
  );
}

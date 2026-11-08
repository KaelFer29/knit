import type { DiffItem } from "../config/diff";
import type { ConfigFileEntry } from "../config/api";
import { DiffView } from "../molecules/DiffView";
import "./ConfigEditor.css";

export interface ConfigEditorProps {
  file: ConfigFileEntry;
  draft: string;
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

/** One file: the text area, the review step with its diff, and the outcome of the last save. Presentational. */
export function ConfigEditor(props: ConfigEditorProps) {
  const { file, step, notice } = props;
  return (
    <section className="config-editor" aria-label={`Editing ${file.label}`}>
      <header className="config-editor__header">
        <div>
          <h2 className="config-editor__title">{file.label}</h2>
          <p className="config-editor__path">
            {file.displayPath} · {file.scope}
            {file.exists ? "" : " · does not exist yet, saving creates it"}
          </p>
        </div>
        <div className="config-editor__actions">
          {step === "edit" ? (
            <button type="button" className="config-editor__button config-editor__button--primary" disabled={!props.changed || props.problem !== undefined} onClick={props.onReview}>
              Review changes
            </button>
          ) : (
            <>
              <button type="button" className="config-editor__button" onClick={props.onBack} disabled={props.saving}>
                Keep editing
              </button>
              <button type="button" className="config-editor__button config-editor__button--primary" onClick={props.onSave} disabled={props.saving}>
                {props.saving ? "Saving…" : "Save"}
              </button>
            </>
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

      {step === "edit" ? (
        <textarea
          className="config-editor__text"
          aria-label={`Contents of ${file.label}`}
          value={props.draft}
          spellCheck={false}
          onChange={(event) => props.onDraft(event.target.value)}
        />
      ) : (
        <>
          <p className="config-editor__hint">Review what will change. The current version is backed up before it is replaced.</p>
          <DiffView items={props.diff} />
        </>
      )}
    </section>
  );
}

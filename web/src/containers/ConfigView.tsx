import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { listConfigFiles, readConfigFile, saveConfigFile, type ConfigFileContent, type ConfigFileEntry } from "../config/api";
import { diffLines, isChanged, withContext } from "../config/diff";
import { ConfigEditor } from "../organisms/ConfigEditor";
import { ConfigFileList } from "../organisms/ConfigFileList";
import "./ConfigView.css";

const CONTEXT_LINES = 3;

const message = (err: unknown): string => (err instanceof Error ? err.message : "Something went wrong");

/** A JSON file must stay a JSON object; the server checks it too, this only explains it before the review. */
function jsonProblem(content: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(content);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? undefined : "This file must be a JSON object.";
  } catch (err) {
    return `This file must be valid JSON: ${message(err)}`;
  }
}

type Notice = { kind: "saved" | "error"; text: string; canReload?: boolean };

/**
 * Container: lists the editable files, loads the selected one, and walks edit -> review (diff) -> save.
 * Saving sends the hash of the version that was read, so a file changed elsewhere is reported, never overwritten.
 */
export function ConfigView() {
  const [files, setFiles] = useState<ConfigFileEntry[] | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [loaded, setLoaded] = useState<ConfigFileContent | undefined>();
  const [draft, setDraft] = useState("");
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | undefined>();
  /** Counts file loads: an answer for an earlier click is dropped, so a slow read never lands under another file's name. */
  const loadSeq = useRef(0);

  const refreshList = useCallback(async () => {
    try {
      setFiles(await listConfigFiles());
      setLoadError(undefined);
    } catch (err) {
      setLoadError(message(err));
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const load = useCallback(async (id: string, keepNotice?: Notice) => {
    const mine = ++loadSeq.current;
    setSelectedId(id);
    setLoaded(undefined);
    setStep("edit");
    setNotice(keepNotice);
    try {
      const content = await readConfigFile(id);
      if (mine !== loadSeq.current) return;
      setLoaded(content);
      setDraft(content.content);
    } catch (err) {
      if (mine !== loadSeq.current) return;
      setLoaded(undefined);
      setNotice({ kind: "error", text: message(err) });
    }
  }, []);

  const file = files?.find((f) => f.id === selectedId);
  const changed = loaded !== undefined && draft !== loaded.content;
  const problem = loaded?.json && changed ? jsonProblem(draft) : undefined;
  const diff = useMemo(
    () => (step === "review" && loaded ? withContext(diffLines(loaded.content, draft), CONTEXT_LINES) : []),
    [step, loaded, draft],
  );

  const save = async (): Promise<void> => {
    if (!loaded || !isChanged(diffLines(loaded.content, draft))) return;
    setSaving(true);
    try {
      const result = await saveConfigFile(loaded.id, draft, loaded.hash);
      setLoaded({ ...loaded, exists: true, content: draft, hash: result.hash });
      setStep("edit");
      setNotice({ kind: "saved", text: result.backupPath ? `Saved. The previous version is at ${result.backupPath}` : "Saved. The file did not exist before, so there is no backup." });
      void refreshList();
    } catch (err) {
      const conflict = err instanceof ApiError && err.status === 409;
      setStep("edit");
      setNotice({ kind: "error", text: message(err), ...(conflict ? { canReload: true } : {}) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="config-view">
      <aside className="config-view__side">
        {files ? <ConfigFileList files={files} selectedId={selectedId} onSelect={(id) => void load(id)} /> : loadError ? null : <p className="config-view__muted">Loading…</p>}
      </aside>
      <div className="config-view__main">
        {loadError ? (
          <p className="config-view__error" role="alert">
            {loadError}
          </p>
        ) : null}
        {file && loaded ? (
          <ConfigEditor
            file={{ ...file, exists: loaded.exists }}
            draft={draft}
            step={step}
            diff={diff}
            problem={problem}
            changed={changed}
            saving={saving}
            notice={notice}
            onDraft={(text) => {
              setDraft(text);
              if (notice?.kind === "saved") setNotice(undefined);
            }}
            onReview={() => setStep("review")}
            onBack={() => setStep("edit")}
            onSave={() => void save()}
            onReload={() => void load(file.id)}
          />
        ) : file && notice ? (
          <p className="config-view__error" role="alert">
            {notice.text}
          </p>
        ) : !loadError ? (
          <p className="config-view__muted">Pick a file to edit. Changes are shown as a diff before anything is saved, and the previous version is always backed up.</p>
        ) : null}
      </div>
    </div>
  );
}

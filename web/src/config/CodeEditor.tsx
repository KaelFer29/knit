import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import "./CodeEditor.css";

export type EditorLanguage = "markdown" | "json" | "text";

export interface CodeEditorProps {
  /** Identity of the document: a new key swaps in a fresh document and a fresh undo history; the same key keeps both. */
  docKey: string;
  /** Text the document starts with for this `docKey`. Later changes of this prop are ignored: the editor owns the text. */
  initialDoc: string;
  language: EditorLanguage;
  /** Accessible name of the editing area. */
  label: string;
  /** Read-only keeps the instance, the selection and the history (used while the diff is under review). */
  readOnly: boolean;
  onChange: (text: string) => void;
  /** Called on Escape; return true to keep Escape from reaching the page (it would close the panel). */
  onEscape?: () => boolean;
}

const languageExtension = (language: EditorLanguage): Extension => (language === "json" ? json() : language === "markdown" ? markdown() : []);
const labelExtension = (label: string): Extension => EditorView.contentAttributes.of({ "aria-label": label, "aria-multiline": "true", spellcheck: "false" });
const readOnlyExtension = (readOnly: boolean): Extension => EditorState.readOnly.of(readOnly);

/**
 * CodeMirror 6 editor. One instance lives as long as the file is open: `docKey` only changes when another file
 * (or a fresh read of it) is loaded, so the undo history survives the round trip to the review step.
 * Keyboard: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y (Cmd on macOS) undo and redo by edit groups. Tab is not bound, so it leaves the editor.
 */
export function CodeEditor(props: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | undefined>(undefined);
  const latest = useRef(props);
  latest.current = props;
  const slots = useRef({ readOnly: new Compartment(), language: new Compartment(), label: new Compartment() });

  const makeState = (doc: string): EditorState => {
    const p = latest.current;
    return EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        syntaxHighlighting(classHighlighter),
        keymap.of([{ key: "Escape", run: () => latest.current.onEscape?.() ?? false }, ...defaultKeymap, ...historyKeymap]),
        slots.current.language.of(languageExtension(p.language)),
        slots.current.readOnly.of(readOnlyExtension(p.readOnly)),
        slots.current.label.of(labelExtension(p.label)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) latest.current.onChange(update.state.doc.toString());
        }),
      ],
    });
  };

  // The view is created once and destroyed with the component; later props flow through compartments.
  useEffect(() => {
    const view = new EditorView({ state: makeState(latest.current.initialDoc), parent: host.current ?? undefined });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = undefined;
    };
  }, []);

  // Another document: a new state, so the history of the previous file never applies to it.
  const shownKey = useRef(props.docKey);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || shownKey.current === props.docKey) return;
    shownKey.current = props.docKey;
    view.setState(makeState(props.initialDoc));
  }, [props.docKey]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        slots.current.readOnly.reconfigure(readOnlyExtension(props.readOnly)),
        slots.current.language.reconfigure(languageExtension(props.language)),
        slots.current.label.reconfigure(labelExtension(props.label)),
      ],
    });
  }, [props.readOnly, props.language, props.label]);

  return <div ref={host} className="code-editor" data-readonly={props.readOnly ? "true" : undefined} />;
}

export default CodeEditor;

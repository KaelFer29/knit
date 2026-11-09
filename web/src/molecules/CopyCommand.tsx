import { useEffect, useRef, useState } from "react";
import "./CopyCommand.css";

type CopyState = "idle" | "copied" | "failed";

interface Props {
  command: string;
  /** Visible label above the command. */
  label?: string;
}

/** A command to run in a terminal with a copy button. The text stays selectable if the clipboard is unavailable. */
export function CopyCommand({ command, label = "Continue in terminal" }: Props) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async (): Promise<void> => {
    let next: CopyState = "copied";
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      next = "failed";
    }
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  };

  return (
    <div className="copy-command">
      <span className="copy-command__label">{label}</span>
      <div className="copy-command__row">
        <code className="copy-command__code">{command}</code>
        <button type="button" className="copy-command__button" onClick={() => void copy()}>
          {state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : "Copy"}
        </button>
      </div>
      <span className="sr-only" role="status">
        {state === "copied" ? "Command copied" : ""}
      </span>
    </div>
  );
}

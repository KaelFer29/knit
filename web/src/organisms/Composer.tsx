import { useId, useRef, useState, type KeyboardEvent } from "react";
import { CommandPalette } from "../molecules/CommandPalette";
import { ProfileBar } from "../molecules/ProfileBar";
import { RouteSwitch } from "../molecules/RouteSwitch";
import { filterCommands, knitCommandOf, paletteQuery, type PaletteCommand } from "../sessions/commands";
import type { AgentView, Profile } from "../sessions/types";
import "./Composer.css";

interface Props {
  agent: AgentView;
  models: string[];
  profile: Profile;
  onProfileChange: (profile: Profile) => void;
  /** Knit's own commands plus the agent's (see `paletteCommands`). */
  commands: PaletteCommand[];
  /** Sends the text to the agent; resolves true when it was accepted, so the field can be cleared. */
  onSubmit: (prompt: string) => Promise<boolean>;
  /** A Knit command other than `/model`, which the composer handles itself. */
  onKnitCommand: (name: string) => void;
  /** A turn is running or a request is in flight: sending waits. */
  busy: boolean;
  busyLabel?: string;
  error?: string;
  placeholder?: string;
  /** The "send to the orchestrator" switch; absent when the container offers no routing. */
  routing?: { on: boolean; onChange: (on: boolean) => void; disabled?: boolean | undefined; reason?: string | undefined };
}

/** Prompt field with the command palette and the per-turn profile. Presentational: the container sends and tracks. */
export function Composer({ agent, models, profile, onProfileChange, commands, onSubmit, onKnitCommand, busy, busyLabel, error, placeholder, routing }: Props) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const modelField = useRef<HTMLButtonElement | null>(null);
  const paletteId = useId();

  const query = paletteQuery(text);
  const matches = query === undefined || dismissed ? [] : filterCommands(commands, query);
  const open = matches.length > 0;

  const change = (value: string): void => {
    setText(value);
    setActive(0);
    setDismissed(false);
  };

  const runKnit = (command: PaletteCommand): void => {
    setText("");
    if (command.name === "model") modelField.current?.click();
    else onKnitCommand(command.name);
  };

  const pick = (command: PaletteCommand): void => {
    if (command.source === "knit") return runKnit(command);
    change(`/${command.name} `);
    field.current?.focus();
  };

  const submit = async (): Promise<void> => {
    const prompt = text.trim();
    if (prompt === "") return;
    const own = knitCommandOf(prompt, commands);
    if (own) return runKnit(own);
    if (busy) return;
    if (await onSubmit(prompt)) change("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(matches[Math.min(active, matches.length - 1)]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {error ? (
        <p className="composer__error" role="alert">
          {error}
        </p>
      ) : null}
      {routing?.on ? (
        <p className="composer__route-hint" role="status">
          The agent will write a plan; you confirm it before anything runs.
        </p>
      ) : null}
      <div className="composer__box">
        {open ? <CommandPalette id={paletteId} commands={matches} activeIndex={Math.min(active, matches.length - 1)} onPick={pick} /> : null}
        <textarea
          ref={field}
          className="composer__field"
          rows={3}
          value={text}
          placeholder={placeholder ?? `Message ${agent.label}. Type / for commands.`}
          aria-label={`Message ${agent.label}`}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? paletteId : undefined}
          aria-activedescendant={open ? `${paletteId}-option-${Math.min(active, matches.length - 1)}` : undefined}
          aria-autocomplete="list"
          onChange={(e) => change(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="composer__bar">
          <button
            type="button"
            className="composer__slash"
            aria-label="Commands"
            title="Commands"
            onClick={() => {
              if (text === "") change("/");
              field.current?.focus();
            }}
          >
            /
          </button>
          {routing ? <RouteSwitch on={routing.on} onChange={routing.onChange} disabled={routing.disabled} reason={routing.reason} /> : null}
          <ProfileBar agent={agent} models={models} profile={profile} onChange={onProfileChange} modelRef={modelField} />
          <div className="composer__send">
            {busy ? <span className="composer__busy">{busyLabel ?? "Working…"}</span> : null}
            <button type="submit" className="composer__button" aria-label="Send" title="Send (Enter; Shift+Enter for a new line)" disabled={busy || text.trim() === ""}>
              <span aria-hidden="true">↑</span>
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

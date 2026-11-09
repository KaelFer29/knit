import { useEffect, useRef, useState } from "react";
import { Popover } from "../../../molecules/Popover";
import { formatAgo } from "../../../sessions/format";
import type { Session, SessionListEntry } from "../../../sessions/types";
import "./ClaudePanelHeader.css";

interface Props {
  /** Only this agent's sessions. */
  sessions: SessionListEntry[];
  /** The open session's id; undefined while a new conversation is open. */
  selectedId: string | undefined;
  session: Session | undefined;
  /** The name shown for a session: the one the person gave it, else its own title. */
  titleOf: (id: string, original: string) => string;
  /** Gives a conversation a name; an empty name brings the original back. */
  onRename: (id: string, title: string) => void;
  now: number;
  onSelect: (id: string) => void;
  onNew: () => void;
}

const icon = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

/** The title that can be renamed in place: a button with a pencil to start, a field while editing. */
function Title({ session, title, onRename }: { session: Session; title: string; onRename: (title: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const field = useRef<HTMLInputElement>(null);
  const edit = useRef<HTMLButtonElement>(null);
  const wasBack = useRef(false);
  useEffect(() => {
    if (editing) field.current?.select();
    if (editing || !wasBack.current) return;
    // Back on the pencil one tick later: moving the focus inside the Enter key's own event would let that same key
    // press the pencil and open the field again.
    const timer = window.setTimeout(() => edit.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [editing]);

  const finish = (save: boolean): void => {
    if (save && draft.trim() !== title) onRename(draft);
    wasBack.current = true;
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={field}
        className="claude-head__field"
        aria-label="Conversation title"
        value={draft}
        maxLength={80}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          else if (e.key === "Escape") {
            // This Escape is for the field only: it must not close the modal around it.
            e.preventDefault();
            e.stopPropagation();
            setDraft(title);
            wasBack.current = true;
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <>
      <h3 className="claude-head__name" title={session.title === title ? title : `${title} (${session.title})`}>
        {title}
      </h3>
      <button
        ref={edit}
        type="button"
        className="claude-head__edit"
        aria-label="Rename conversation"
        title="Rename conversation"
        onClick={() => {
          setDraft(title);
          setEditing(true);
        }}
      >
        <svg {...icon} width={14} height={14}>
          <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" />
        </svg>
      </button>
    </>
  );
}

/** The session bar: its name (renamable) on the left; the history menu and the new-session button at the right end. */
export function ClaudePanelHeader({ sessions, selectedId, session, titleOf, onRename, now, onSelect, onNew }: Props) {
  return (
    <header className="claude-head">
      <div className="claude-head__title">
        {session === undefined ? (
          <h3 className="claude-head__name">New conversation</h3>
        ) : (
          <Title key={session.id} session={session} title={titleOf(session.id, session.title)} onRename={(t) => onRename(session.id, t)} />
        )}
        {session?.status === "running" ? <span className="claude-head__live">Working</span> : null}
      </div>
      <div className="claude-head__tools">
        <Popover
          label="Conversation history"
          direction="down"
          align="end"
          triggerClassName="claude-head__icon"
          trigger={
            <svg {...icon}>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          }
        >
          {({ close }) =>
            sessions.length === 0 ? (
              <p className="claude-head__none">No conversations yet.</p>
            ) : (
              <ul className="claude-head__list">
                {sessions.map(({ session: s }) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="claude-head__item"
                      data-current={s.id === selectedId}
                      onClick={() => {
                        onSelect(s.id);
                        close();
                      }}
                    >
                      <span className="claude-head__item-title">{titleOf(s.id, s.title)}</span>
                      <span className="claude-head__item-meta">{s.status === "running" ? "Working" : formatAgo(s.updatedAt, now)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          }
        </Popover>
        <button type="button" className="claude-head__icon" aria-label="New session" title="New session" onClick={onNew}>
          <svg {...icon}>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
    </header>
  );
}

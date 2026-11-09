import type { ReactNode, RefObject } from "react";
import { Popover } from "./Popover";
import { modelChoices, modelInfo } from "../sessions/models";
import type { AgentView, Profile, ProfileField } from "../sessions/types";
import "./ProfileBar.css";

interface Props {
  agent: AgentView;
  /** Model ids the agent offered; empty means the model is free text. */
  models: string[];
  profile: Profile;
  onChange: (profile: Profile) => void;
  /** The model chip, so `/model` can open it. */
  modelRef?: RefObject<HTMLButtonElement | null>;
}

/** The levels `--effort` accepts, from lightest to heaviest. The slider starts at "Default": the agent's own choice. */
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const PERMISSIONS: { value: string; label: string; hint: string }[] = [
  { value: "", label: "Default", hint: "Ask before edits" },
  { value: "acceptEdits", label: "Accept edits", hint: "Edit files without asking" },
  { value: "plan", label: "Plan", hint: "Think and plan, change nothing" },
];

function Option({ checked, label, hint, onPick }: { checked: boolean; label: string; hint?: string; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={checked} aria-label={label} className="pick" data-checked={checked} onClick={onPick}>
      <span className="pick__text">
        <span className="pick__label">{label}</span>
        {hint === undefined ? null : <span className="pick__hint">{hint}</span>}
      </span>
      <span className="pick__check" aria-hidden="true">
        {checked ? "✓" : ""}
      </span>
    </button>
  );
}

function Group({ label, heading, children }: { label: string; heading: string; children: ReactNode }) {
  return (
    <div className="pick-group">
      <p className="pick-group__heading">{heading}</p>
      <div role="radiogroup" aria-label={label} className="pick-group__list">
        {children}
      </div>
    </div>
  );
}

/**
 * The per-turn profile as two chips in the composer: one for the model and effort, one for the permission mode, each
 * opening a small menu. It shows only the fields the agent takes, and the model only when the agent declares it can
 * choose one (the field list and the capability both come from the API).
 */
export function ProfileBar({ agent, models, profile, onChange, modelRef }: Props) {
  const has = (f: ProfileField): boolean => agent.profileFields.includes(f);
  const showModel = has("model") && agent.capabilities.chooseModel;
  const showEffort = has("effort");
  const showPermission = has("permissionMode");
  if (!showModel && !showEffort && !showPermission) return null;

  const set = (field: ProfileField, value: string): void => {
    const next = { ...profile };
    if (value === "") delete next[field];
    else next[field] = value;
    onChange(next);
  };
  const effortIndex = profile.effort === undefined ? 0 : Math.max(0, EFFORTS.indexOf(profile.effort) + 1);
  const permission = PERMISSIONS.find((p) => p.value === (profile.permissionMode ?? ""));

  return (
    <div className="profile-bar" role="group" aria-label="Settings for the next turn">
      {showModel || showEffort ? (
        <Popover
          label="Model and effort"
          triggerRef={modelRef}
          triggerClassName="chip"
          trigger={
            <>
              <span className="chip__main">{showModel ? (profile.model === undefined ? "Default model" : modelInfo(profile.model).name) : profile.effort ? "Effort" : "Default effort"}</span>
              {profile.effort ? <span className="chip__sub">{profile.effort}</span> : null}
            </>
          }
        >
          {showModel ? (
            <Group label="Model" heading="Select a model">
              {models.length === 0 ? (
                <input className="pick-input" type="text" aria-label="Model" value={profile.model ?? ""} placeholder="Default model" autoComplete="off" spellCheck={false} onChange={(e) => set("model", e.target.value.trim())} />
              ) : (
                <>
                  <Option checked={profile.model === undefined} label="Default (recommended)" hint="The agent's own default" onPick={() => set("model", "")} />
                  {modelChoices(models).map((m) => (
                    <Option key={m.id} checked={profile.model !== undefined && modelInfo(profile.model).name === m.name} label={m.name} {...(m.hint === undefined ? {} : { hint: m.hint })} onPick={() => set("model", m.id)} />
                  ))}
                </>
              )}
            </Group>
          ) : null}
          {showEffort ? (
            <div className="effort">
              <p className="pick-group__heading">{`Effort (${profile.effort ?? "Default"})`}</p>
              <div className="effort__track">
                <span className="effort__dots" aria-hidden="true">
                  {Array.from({ length: EFFORTS.length + 1 }, (_, i) => (
                    <span key={i} data-reached={i <= effortIndex} />
                  ))}
                </span>
                <input
                  className="effort__slider"
                  type="range"
                  min={0}
                  max={EFFORTS.length}
                  step={1}
                  value={effortIndex}
                  aria-label="Effort"
                  aria-valuetext={profile.effort ?? "Default"}
                    onChange={(e) => {
                    const i = Number(e.target.value);
                    set("effort", i === 0 ? "" : EFFORTS[i - 1]!);
                  }}
                />
              </div>
              <div className="effort__scale" aria-hidden="true">
                <span>Default</span>
                <span>Max</span>
              </div>
            </div>
          ) : null}
        </Popover>
      ) : null}
      {showPermission ? (
        <Popover label="Permission mode" triggerClassName="chip" trigger={<span className="chip__main">Permissions: {permission?.label ?? profile.permissionMode}</span>}>
          {({ close }) => (
            <Group label="Permission mode" heading="Permission mode">
              {PERMISSIONS.map((p) => (
                <Option
                  key={p.label}
                  checked={(profile.permissionMode ?? "") === p.value}
                  label={p.label}
                  hint={p.hint}
                  onPick={() => {
                    set("permissionMode", p.value);
                    close();
                  }}
                />
              ))}
            </Group>
          )}
        </Popover>
      ) : null}
    </div>
  );
}

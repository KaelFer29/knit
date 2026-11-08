import { useId, type MutableRefObject } from "react";
import type { AgentView, Profile, ProfileField } from "../sessions/types";
import "./ProfileBar.css";

interface Props {
  agent: AgentView;
  /** Model ids the agent offered; empty means the field is free text. */
  models: string[];
  profile: Profile;
  onChange: (profile: Profile) => void;
  /** Receives the model field, so `/model` can move focus to it. */
  modelRef?: MutableRefObject<HTMLSelectElement | HTMLInputElement | null>;
}

const LABELS: Record<ProfileField, string> = { model: "Model", effort: "Effort", permissionMode: "Permission mode" };
const SUGGESTIONS: Partial<Record<ProfileField, string[]>> = {
  effort: ["low", "medium", "high"],
  permissionMode: ["default", "acceptEdits", "plan"],
};

/**
 * The per-turn profile next to the composer. It shows only the fields the agent takes, and the model picker only when
 * the agent declares it can choose a model (the field list and the capability both come from the API).
 */
export function ProfileBar({ agent, models, profile, onChange, modelRef }: Props) {
  const base = useId();
  const set = (field: ProfileField, value: string): void => {
    const next = { ...profile };
    if (value === "") delete next[field];
    else next[field] = value;
    onChange(next);
  };
  const keep = (el: HTMLSelectElement | HTMLInputElement | null): void => {
    if (modelRef) modelRef.current = el;
  };
  const fields = agent.profileFields.filter((f) => f !== "model" || agent.capabilities.chooseModel);
  if (fields.length === 0) return null;
  return (
    <div className="profile-bar" role="group" aria-label="Settings for the next turn">
      {fields.map((field) => {
        const id = `${base}-${field}`;
        const value = profile[field] ?? "";
        return (
          <label key={field} className="profile-bar__field" htmlFor={id}>
            <span className="profile-bar__label">{LABELS[field]}</span>
            {field === "model" && models.length > 0 ? (
              <select id={id} ref={keep} value={value} onChange={(e) => set(field, e.target.value)}>
                <option value="">Default</option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  id={id}
                  ref={field === "model" ? keep : undefined}
                  type="text"
                  value={value}
                  placeholder="Default"
                  autoComplete="off"
                  spellCheck={false}
                  list={SUGGESTIONS[field] ? `${id}-list` : undefined}
                  onChange={(e) => set(field, e.target.value.trim())}
                />
                {SUGGESTIONS[field] ? (
                  <datalist id={`${id}-list`}>
                    {SUGGESTIONS[field]!.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                ) : null}
              </>
            )}
          </label>
        );
      })}
    </div>
  );
}

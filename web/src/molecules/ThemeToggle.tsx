import type { ReactNode } from "react";
import { THEME_CHOICES, type ThemeChoice } from "../theme/theme";
import "./ThemeToggle.css";

const LABELS: Record<ThemeChoice, string> = { light: "Light", dark: "Dark", system: "System" };

const icon = (paths: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {paths}
  </svg>
);

const ICONS: Record<ThemeChoice, ReactNode> = {
  light: icon(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
    </>,
  ),
  dark: icon(<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />),
  system: icon(
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M8.5 20h7M12 16.5V20" />
    </>,
  ),
};

interface Props {
  value: ThemeChoice;
  onChange: (choice: ThemeChoice) => void;
}

/** Segmented control for the theme. Native radios give arrow-key navigation and the group semantics for free. */
export function ThemeToggle({ value, onChange }: Props) {
  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Theme">
      {THEME_CHOICES.map((choice) => (
        <label key={choice} className="theme-toggle__option">
          <input
            className="theme-toggle__input"
            type="radio"
            name="theme"
            value={choice}
            checked={value === choice}
            onChange={() => onChange(choice)}
          />
          <span className="theme-toggle__face">
            {ICONS[choice]}
            <span className="theme-toggle__label">{LABELS[choice]}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

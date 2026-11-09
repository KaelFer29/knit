import { useState, type CSSProperties } from "react";
import { logoUrl, type AgentIdentity } from "../identity/agents";
import { KnitMark } from "./KnitMark";
import { PointerMark } from "./PointerMark";
import "./Logo.css";

type LogoState = "loading" | "ready" | "fallback" | "mark";

interface Props {
  identity: AgentIdentity;
  /** Edge length in px; defaults to the `--logo-size` token. */
  size?: number;
}

/**
 * The identity's logo. Loads the official file from `/brand/` and shows the monogram while it loads
 * and for good when the file is missing or fails. Decorative: the label next to it names the agent.
 */
export function Logo({ identity, size }: Props) {
  const url = logoUrl(identity);
  // The outcome belongs to one URL: a different identity starts again.
  const [outcome, setOutcome] = useState<{ url: string; state: "ready" | "fallback" } | undefined>();
  const settled = outcome !== undefined && outcome.url === url ? outcome.state : undefined;

  const state: LogoState = identity.monogramOnly ? "fallback" : url === undefined ? "mark" : (settled ?? "loading");
  const style = {
    "--logo-accent": identity.accent,
    "--logo-accent-soft": identity.accentSoft,
    ...(size === undefined ? {} : { "--logo-size": `${size}px` }),
  } as CSSProperties;

  return (
    <span className="logo" data-state={state} data-monochrome={identity.monochrome ? "true" : undefined} data-tile={identity.logoTile ? "true" : undefined} style={style} aria-hidden="true">
      {state === "mark" ? <KnitMark /> : null}
      {url !== undefined && state !== "fallback" ? (
        <img className="logo__img" src={url} alt="" onLoad={() => setOutcome({ url, state: "ready" })} onError={() => setOutcome({ url, state: "fallback" })} />
      ) : null}
      {state === "loading" || state === "fallback" ? identity.fallbackMark === "pointer" ? <PointerMark /> : <span className="logo__monogram">{identity.monogram}</span> : null}
    </span>
  );
}

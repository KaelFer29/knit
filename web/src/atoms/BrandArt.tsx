import { useState } from "react";
import { logoUrl, type AgentIdentity } from "../identity/agents";
import { PointerMark } from "./PointerMark";

/**
 * An identity's logo drawn large as decoration (a backdrop): the official file when it loads, else the mark drawn in
 * code. Hidden from assistive technology; the text over it says what the screen is.
 */
export function BrandArt({ identity, className }: { identity: AgentIdentity; className?: string }) {
  const url = logoUrl(identity);
  const [failed, setFailed] = useState(false);
  if (url !== undefined && !failed) return <img className={className} src={url} alt="" aria-hidden="true" onError={() => setFailed(true)} />;
  return identity.fallbackMark === "pointer" ? <PointerMark className={className} /> : null;
}

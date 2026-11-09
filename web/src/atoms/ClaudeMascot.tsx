import type { CSSProperties } from "react";

/**
 * Claude Code's terminal mascot as a drawing on a pixel grid: a body with two eyes cut out, a stub arm on each side
 * and four legs. Text blocks drift apart in some fonts; a drawing always keeps its shape. It takes its color from
 * `currentColor` and its size from the font size (5em wide). Decorative.
 */
export function ClaudeMascot({ className }: { className?: string }) {
  const style: CSSProperties = { width: "5em", height: "auto", display: "block", overflow: "visible" };
  return (
    <svg className={className} style={style} viewBox="0 0 20 12" fill="currentColor" aria-hidden="true" focusable="false">
      {/* Body 2..18 wide, 0..8 high, with the eyes as holes. */}
      <path data-part="body" fillRule="evenodd" d="M2 0H18V8H2V0ZM5 2H7V5H5V2ZM13 2H15V5H13V2Z" />
      {/* Arms. */}
      <rect x="0" y="3" width="2" height="3" />
      <rect x="18" y="3" width="2" height="3" />
      {/* Legs. */}
      <rect data-part="leg" x="4" y="8" width="2" height="3" />
      <rect data-part="leg" x="7" y="8" width="2" height="3" />
      <rect data-part="leg" x="11" y="8" width="2" height="3" />
      <rect data-part="leg" x="14" y="8" width="2" height="3" />
    </svg>
  );
}

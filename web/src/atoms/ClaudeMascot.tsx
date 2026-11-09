/** Claude Code's terminal mascot, drawn with block characters the way the CLI prints it. Decorative. */
const ROWS = [" ▐▛███▜▌", "▝▜█████▛▘", "  ▘▘ ▝▝"];

export function ClaudeMascot({ className }: { className?: string }) {
  return (
    <span className={className} aria-hidden="true" style={{ display: "inline-flex", flexDirection: "column", fontFamily: "var(--font-mono)", lineHeight: 1, whiteSpace: "pre" }}>
      {ROWS.map((row) => (
        <span key={row}>{row}</span>
      ))}
    </span>
  );
}

/**
 * Knit's own mark: two threads looped through each other, each passing over the other once.
 * Drawn with `currentColor`, so the surrounding component picks the color from a token.
 */
export function KnitMark({ title }: { title?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      {/* Left loop: broken where it passes under the right one (bottom crossing). */}
      <path d="M10.654 17.768A6 6 0 1 1 13.168 16.316" />
      {/* Right loop: broken where it passes under the left one (top crossing). */}
      <path d="M13.346 6.232A6 6 0 1 1 10.832 7.684" />
    </svg>
  );
}

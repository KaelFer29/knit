/** A plain pointer arrow, drawn in code: Cursor's stand-in mark while its logo file is missing. Decorative. */
export function PointerMark({ className }: { className?: string }) {
  return (
    <svg className={className} data-mark="pointer" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M5.5 3.2a.7.7 0 0 1 1.1-.6l13.1 8.6a.7.7 0 0 1-.2 1.3l-5.4 1.5a.7.7 0 0 0-.4.3l-2.6 5a.7.7 0 0 1-1.3-.1L5.5 3.2Z" />
    </svg>
  );
}

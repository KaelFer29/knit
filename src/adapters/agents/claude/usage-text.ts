import type { PlanWindow } from "../../../core/ports/agent-runner.js";

/** "Current session: 36% used · resets Nov 9, 3:10am (America/Santiago)" and the like; tips below never start with "Current". */
const WINDOW = /^(Current [^:]+):\s*(\d+)% used(?:\s*·\s*resets\s+(.+))?$/;

/** The plan windows in the text Claude Code prints for `/usage`, in the order it prints them. Pure. */
export function parseUsageText(text: string): PlanWindow[] {
  const windows: PlanWindow[] = [];
  for (const raw of text.split("\n")) {
    const match = WINDOW.exec(raw.trim());
    if (match === null) continue;
    const percent = Math.max(0, Math.min(100, Number(match[2])));
    windows.push(match[3] === undefined ? { label: match[1]!.trim(), percent } : { label: match[1]!.trim(), percent, resets: match[3].trim() });
  }
  return windows;
}

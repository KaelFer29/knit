/** What the page knows about a delivered task when the person wants to keep working on it. */
export interface IterationTarget {
  taskId: string;
  title: string;
  branch?: string | undefined;
  goal?: string | undefined;
  specs?: { id: string; text: string }[] | undefined;
}

/**
 * What an iteration asks Claude for: the instruction to send to Cursor for a task it already delivered, in one fenced
 * block, and nothing else. Claude never changes files or starts anything: the person reviews the instruction and sends
 * it to the orchestrator, which continues the same Cursor chat on the same branch. The request goes last and
 * untouched, so Claude reads the rules first.
 */
export function iterationPrompt(task: IterationTarget, request: string): string {
  const specs = task.specs ?? [];
  return [
    "I want to iterate on a task Cursor already delivered, on the same branch and in the same Cursor chat. Do not write a plan, do not change files and do not start anything.",
    "",
    [
      `Task ${task.taskId}: ${task.title}`,
      ...(task.branch === undefined ? [] : [`Branch: ${task.branch}`]),
      ...(task.goal === undefined || task.goal === "" ? [] : [`Goal: ${task.goal}`]),
      ...(specs.length === 0 ? [] : ["Specs:", ...specs.map((s) => `- ${s.id}: ${s.text}`)]),
    ].join("\n"),
    "",
    "Write what Cursor should do next, as an instruction to Cursor, inside one fenced block labelled followup, with nothing Cursor does not need:",
    "",
    "```followup",
    "<the instruction>",
    "```",
    "",
    "Cursor already has the task, its specs and the work it did in its chat. The follow-up is checked against the task's own specs and allowed files, so ask only for changes inside them.",
    "",
    "Request (what to change):",
    request.trim(),
  ].join("\n");
}

/**
 * The instruction in the last fenced block labelled `followup` of an answer, or undefined when there is none. A block
 * quoted inside another fence is not one, and a block that is never closed or is empty does not count.
 */
export function extractFollowup(answer: string | undefined): string | undefined {
  if (answer === undefined) return undefined;
  let found: string | undefined;
  let open: { ticks: number; label: string; lines: string[] } | undefined;
  for (const line of answer.split(/\r?\n/)) {
    if (open === undefined) {
      const m = /^(`{3,})\s*([^`\s]*)\s*$/.exec(line);
      if (m !== null) open = { ticks: m[1]!.length, label: m[2]!, lines: [] };
      continue;
    }
    const closing = /^(`{3,})\s*$/.exec(line);
    if (closing !== null && closing[1]!.length >= open.ticks) {
      const text = open.lines.join("\n").trim();
      if (open.label === "followup" && text !== "") found = text;
      open = undefined;
    } else {
      open.lines.push(line);
    }
  }
  return found;
}

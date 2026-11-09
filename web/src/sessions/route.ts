/**
 * What "send to the orchestrator" asks the agent for: a plan in the Knit format, written where the interface lists
 * drafts, with the Cursor model of each task chosen by its complexity, and nothing else. The agent never starts a run; the person confirms the draft with one click. The request
 * goes last and untouched, so the agent reads the rules first.
 */
export function routedPrompt(request: string): string {
  return [
    "Write a development plan for the request below in the Knit plan format (see docs/plan-format.md in this repository, or use the knit-plan skill if you have it).",
    "Choose the model Cursor uses for each task with a `Model:` line, by the task's complexity: pick from the ids `agent models` prints (`auto` when unsure or the work is small and mechanical, a stronger one for design, security or concurrency, a faster one for repetitive edits).",
    "Save it as docs/plans/<slug>.md and validate it with `knit validate`.",
    "Do not implement anything and do not start a run: the person reviews the plan and sends it to the orchestrator.",
    "",
    "Request:",
    request.trim(),
  ].join("\n");
}

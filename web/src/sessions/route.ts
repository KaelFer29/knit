/**
 * What "send to the orchestrator" asks the agent for: a plan in the Knit format, written where the interface lists
 * drafts, and nothing else. The agent never starts a run; the person confirms the draft with one click. The request
 * goes last and untouched, so the agent reads the rules first.
 */
export function routedPrompt(request: string): string {
  return [
    "Write a development plan for the request below in the Knit plan format (see docs/plan-format.md in this repository, or use the knit-plan skill if you have it).",
    "Save it as docs/plans/<slug>.md and validate it with `knit validate`.",
    "Do not implement anything and do not start a run: the person reviews the plan and sends it to the orchestrator.",
    "",
    "Request:",
    request.trim(),
  ].join("\n");
}

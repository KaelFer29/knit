import type { Task } from "../plan/parse-plan.js";

/** `type: title`, where type is the branch prefix (feat, fix, docs...). */
export function prTitle(task: Task): string {
  return `${task.branch.split("/")[0]}: ${task.title}`;
}

export function prBody(task: Task, runId: string): string {
  const specs = task.specs.map((s) => `- ${s.id}: ${s.text}`).join("\n");
  const checks = task.checks.length > 0 ? task.checks.map((c) => `- \`${c}\``).join("\n") : "None";
  return [
    `## Goal\n${task.goal}`,
    `## Specs\n${specs}`,
    `## Checks\n${checks}`,
    `---\nOpened by Knit run ${runId}.`,
  ].join("\n\n");
}

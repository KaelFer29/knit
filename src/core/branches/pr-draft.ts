import type { BranchCommit } from "../ports/branch-tools.js";

export interface PrTaskRef {
  taskId: string;
  branch?: string;
  dependsOn?: string;
}

export type PrBase = { ok: true; base: string; parent?: { taskId: string; branch: string } } | { ok: false; reason: string };

/**
 * The branch a task's pull request targets: the branch the run started from, or, when the task depends on another, that
 * task's branch (a stacked PR). `runBase` is how the run recorded its base, `<branch>@<sha>`.
 */
export function prBaseOf(runBase: string, task: PrTaskRef, tasks: PrTaskRef[]): PrBase {
  if (task.dependsOn !== undefined) {
    const parent = tasks.find((t) => t.taskId === task.dependsOn);
    if (parent?.branch === undefined) return { ok: false, reason: `${task.dependsOn}, which ${task.taskId} depends on, has no branch to stack the pull request on.` };
    return { ok: true, base: parent.branch, parent: { taskId: parent.taskId, branch: parent.branch } };
  }
  const at = runBase.lastIndexOf("@");
  const name = (at === -1 ? "" : runBase.slice(0, at)).trim();
  if (name === "" || name === "HEAD") return { ok: false, reason: "The run did not start from a branch (its base is not a branch), so there is no branch for the pull request to target." };
  return { ok: true, base: name };
}

export interface PrDraftInput {
  taskId: string;
  title: string;
  goal?: string;
  specs: { id: string; text: string }[];
  commits: BranchCommit[];
  stat: string;
  patch: string;
  /** The patch was cut to fit. */
  truncated: boolean;
}

/** What the cheap model is asked: write the title and body of the pull request, as text only. */
export function buildPrDraftPrompt(input: PrDraftInput): string {
  const lines = [
    "Write the title and the description of a pull request for the change below.",
    "Do not modify files, do not create files and do not run commands: answer with text only.",
    "",
    "Answer in exactly this format: a first line `Title: <one line, at most 70 characters, imperative>`, a blank line, then the description in Markdown (a short summary, then what changed as bullets, then how it was checked). No code fence around the answer.",
    "",
    `Task ${input.taskId}: ${input.title}`,
    ...(input.goal ? [`Goal: ${input.goal}`] : []),
    ...(input.specs.length > 0 ? ["Specs:", ...input.specs.map((s) => `- ${s.id}: ${s.text}`)] : []),
    "",
    "Commits:",
    ...(input.commits.length > 0 ? input.commits.map((c) => `- ${c.subject}`) : ["- (none)"]),
    "",
    "Files changed:",
    input.stat.trim() === "" ? "(none)" : input.stat.trim(),
    "",
    input.truncated ? "Change (the diff was cut to fit; do not guess about the part you cannot see):" : "Change:",
    input.patch.trim() === "" ? "(empty)" : input.patch.trimEnd(),
  ];
  return lines.join("\n");
}

const MAX_TITLE = 100;

/**
 * A pull request's title and description built from what Knit already knows (the task's goal and specs, its commits and
 * the files it changed), with no model and so no tokens. The same sections every time; a model can improve it on request.
 */
export function buildPrTemplate(input: PrDraftInput): { title: string; body: string } {
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE).trim();
  const stat = input.stat.trim();
  const body = [
    "## Summary",
    (input.goal ?? "").trim() === "" ? title : input.goal!.trim(),
    ...(input.specs.length > 0 ? ["", "## Specs", ...input.specs.map((s) => `- ${s.id}: ${s.text}`)] : []),
    "",
    "## Changes",
    ...(input.commits.length > 0 ? input.commits.map((c) => `- ${c.subject}`) : ["- (no commits)"]),
    ...(stat === "" ? [] : ["", "```", stat, "```"]),
    "",
    "## Verification",
    `Passed Knit's checks for ${input.taskId}: the agent process, the files it touched, git hygiene and the task's own checks.`,
  ].join("\n");
  return { title, body };
}

/** Reads the model's answer: a `Title:` line and the rest as the body. A missing title falls back to the task's. */
export function parsePrDraft(text: string, fallbackTitle: string): { title: string; body: string } {
  let t = text.trim();
  const fence = /^```[\w-]*\n([\s\S]*?)\n?```$/.exec(t);
  if (fence) t = fence[1]!.trim();
  const match = /^Title:[ \t]*(.*)$/im.exec(t);
  if (!match) return { title: fallbackTitle, body: t };
  const title = match[1]!.trim().slice(0, MAX_TITLE).trim();
  const body = (t.slice(0, match.index) + t.slice(match.index + match[0].length)).trim();
  return { title: title === "" ? fallbackTitle : title, body };
}

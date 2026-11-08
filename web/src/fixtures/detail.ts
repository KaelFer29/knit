/** Detail data for the board fixtures: a plan text, notes, a sample timeline and a sample diff, so every panel can be seen without a server. */
import type { BoardModel } from "@board";
import type { DetailSource, TaskDiffData, TimelineEntry } from "../detail/types";

const PATCH = `@@ -12,7 +12,12 @@ export function verify(body: string, header: string): boolean {
   const expected = sign(body);
-  return expected === header;
+  const a = Buffer.from(expected);
+  const b = Buffer.from(header);
+  if (a.length !== b.length) return false;
+  return timingSafeEqual(a, b);
 }

 export function sign(body: string): string {
   return hmac(SECRET, body);
@@ -40,3 +45,3 @@ export function parseHeader(raw: string) {
-  return raw.split("=")[1];
+  return raw.split("=")[1] ?? "";
 }`;

const NEW_FILE = `@@ -0,0 +1,6 @@
+import { verify } from "./signature";
+
+test("rejects a wrong signature", () => {
+  expect(verify("{}", "bad")).toBe(false);
+});
+`;

const DIFF: Omit<TaskDiffData, "startSha" | "commitSha"> = {
  moreFiles: false,
  files: [
    { path: "src/webhooks/signature.ts", status: "modified", binary: false, additions: 6, deletions: 2, patch: PATCH },
    { path: "src/webhooks/signature.test.ts", status: "added", binary: false, additions: 6, deletions: 0, patch: NEW_FILE },
    { path: "docs/old-notes.md", status: "deleted", binary: false, additions: 0, deletions: 14 },
    { path: "assets/diagram.png", status: "added", binary: true },
  ],
};

const entry = (id: number, minute: number, kind: string, payload: unknown): TimelineEntry => ({
  id,
  ts: new Date(Date.UTC(2026, 10, 3, 9, minute, id)).toISOString(),
  kind,
  payload,
  agent: "cursor",
});

const TIMELINE: TimelineEntry[] = [
  entry(1, 1, "system", { model: "composer-1", permissionMode: "force" }),
  entry(2, 1, "thinking", { text: "The signature is compared with ===, which leaks timing. I will compare buffers in constant time." }),
  entry(3, 1, "tool_started", { tool: "readToolCall", args: { path: "src/webhooks/signature.ts" } }),
  entry(4, 1, "tool_completed", { tool: "readToolCall", result: "export function verify(body: string, header: string) { ... }" }),
  entry(5, 2, "tool_started", { tool: "editToolCall", args: { path: "src/webhooks/signature.ts" } }),
  entry(6, 2, "tool_completed", { tool: "editToolCall", result: "Applied 1 edit" }),
  entry(7, 3, "tool_started", { tool: "shellToolCall", args: { command: "pnpm test" } }),
  entry(8, 3, "tool_completed", { tool: "shellToolCall", result: "1 test failed: rejects a wrong signature", isError: true }),
  entry(9, 4, "message", { text: "Signature checks now run in constant time and the new test covers a wrong signature." }),
  entry(10, 4, "result", { text: "Done.", isError: false, durationMs: 214000 }),
];

const PLAN_TEXT = (planName: string, board: BoardModel): string =>
  [
    `# Plan: ${planName}`,
    "",
    "Repo: ~/code/billing-service",
    "",
    ...board.tasks.flatMap((t) => [`## ${t.taskId}: ${t.title}`, "", `Goal: ${t.goal ?? "(not recorded)"}`, ""]),
  ].join("\n");

export function fixtureDetailSource(board: BoardModel): DetailSource {
  return {
    ...(board.nodes.claude.hasPlanText ? { planText: PLAN_TEXT(board.planName, board) } : {}),
    attemptNotes: (taskId, attempt) => {
      const task = board.tasks.find((t) => t.taskId === taskId);
      const view = task?.attempts.find((a) => a.attempt === attempt);
      if (view === undefined) return { gitProblems: [] };
      if (view.setup) return { output: view.failedCheck === undefined ? "Done in 14.2s" : "ERR_PNPM_NO_LOCKFILE  Cannot install with a frozen lockfile\n", gitProblems: [] };
      return {
        output: view.status === "failed" ? "I updated the signature check but one test still fails." : "Implemented the task and the checks pass.",
        gitProblems: view.status === "failed" && view.scopeOk === false ? ["the task branch has 2 commits after the base"] : [],
      };
    },
    timeline: async () => TIMELINE,
    diff: async (taskId) => {
      const task = board.tasks.find((t) => t.taskId === taskId);
      return { startSha: task?.startSha ?? "a1b2c3d", ...(task?.commitSha === undefined ? {} : { commitSha: task.commitSha }), ...DIFF };
    },
  };
}

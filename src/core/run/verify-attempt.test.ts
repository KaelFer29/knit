import { describe, expect, it } from "vitest";
import type { AgentRunResult } from "../ports/agent-runner.js";
import type { CheckResult, CheckRunner } from "../ports/check-runner.js";
import type { GitInspection, TaskWorkspace, Workspace } from "../ports/workspace.js";
import { describeFailure, verifyAttempt } from "./verify-attempt.js";

const ws: TaskWorkspace = { path: "/wt/T1", branch: "feat/a", startSha: "start" };
const task = { allowedFiles: ["src/a.ts"], checks: ["check one", "check two"] };
const ok: AgentRunResult = { exitCode: 0, isError: false, resultText: "done", durationMs: 1, timedOut: false };

function setup(options: { changed?: string[]; outside?: string[]; inspection?: Partial<GitInspection>; failing?: string; timedOut?: boolean } = {}) {
  const ran: string[] = [];
  const workspace = {
    changedPaths: () => options.changed ?? ["src/a.ts"],
    outsideChanges: () => options.outside ?? [],
    inspect: (): GitInspection => ({
      branch: "feat/a",
      historyIntact: true,
      commits: [{ sha: "c1", subject: "feat(a): add a", body: "" }],
      uncommitted: [],
      ...options.inspection,
    }),
  } as unknown as Workspace;
  const checks: CheckRunner = {
    run: async (command): Promise<CheckResult> => {
      ran.push(command);
      const fails = command === options.failing;
      return { command, exitCode: fails ? 1 : 0, output: fails ? "boom" : "fine", durationMs: 1, timedOut: fails && options.timedOut === true };
    },
  };
  return { deps: { workspace, checks }, ran };
}

const verify = (s: ReturnType<typeof setup>, result: AgentRunResult = ok, started: string[] = []) =>
  verifyAttempt(s.deps, { task, ws, result, checkTimeoutMs: 1000, onCheckStarted: (c) => started.push(c) });

describe("verifyAttempt", () => {
  it("passes when the process ended cleanly, the scope and git work are fine and every check passes", async () => {
    const s = setup();
    const started: string[] = [];
    const v = await verify(s, ok, started);
    expect(v).toMatchObject({ passed: true, problems: {}, violations: [], gitProblems: [] });
    expect(v.inspection.commits).toHaveLength(1);
    expect(s.ran).toEqual(["check one", "check two"]);
    expect(started).toEqual(["check one", "check two"]);
  });

  it("fails on a scope violation, counting entries written next to the worktree, and runs no check", async () => {
    const s = setup({ changed: ["src/a.ts", "src/other.ts"], outside: ["../stray"] });
    const v = await verify(s);
    expect(v.passed).toBe(false);
    expect(v.violations).toEqual(["src/other.ts", "../stray"]);
    expect(v.problems.scopeViolations).toEqual(["src/other.ts", "../stray"]);
    expect(s.ran).toEqual([]);
    expect(describeFailure(v.problems)).toBe("Scope violations: src/other.ts, ../stray");
  });

  it("fails on git problems such as uncommitted files, and runs no check", async () => {
    const s = setup({ inspection: { uncommitted: ["src/a.ts"] } });
    const v = await verify(s);
    expect(v.passed).toBe(false);
    expect(v.gitProblems.length).toBeGreaterThan(0);
    expect(s.ran).toEqual([]);
  });

  it("stops at the first failing check and keeps its output", async () => {
    const s = setup({ failing: "check one" });
    const v = await verify(s);
    expect(v).toMatchObject({ passed: false, failedCheck: "check one", problems: { failedCheck: "check one", output: "boom" } });
    expect(s.ran).toEqual(["check one"]);
  });

  it("notes a timed out check in the output", async () => {
    const v = await verify(setup({ failing: "check two", timedOut: true }));
    expect(v.problems.output).toContain("timed out after 1000 ms");
  });

  it("fails when the agent process failed or timed out, and when nothing changed", async () => {
    const crashed = await verify(setup(), { ...ok, exitCode: 3, isError: true, resultText: "bad" });
    expect(crashed.problems.processFailure).toContain("exit code 3");
    const timedOut = await verify(setup(), { ...ok, exitCode: null, timedOut: true });
    expect(timedOut.problems.processFailure).toBe("The agent timed out.");
    const nothing = await verify(setup({ changed: [] }));
    expect(nothing.problems.processFailure).toBe("No files were changed.");
  });
});

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteRunStore } from "../../src/adapters/storage/sqlite/run-store.js";
import { main, type CliDeps } from "../../src/cli/main.js";
import type { AgentRunner } from "../../src/core/ports/agent-runner.js";

const GIT_ARGS = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null"];
const git = (cwd: string, ...args: string[]): string => execFileSync("git", [...GIT_ARGS, ...args], { cwd, encoding: "utf8" }).trim();

let scratch: string;
let repo: string;
let dataDir: string;

const PLAN = (repoPath: string) => `# Plan: demo plan

Repo: ${repoPath}

## T1: Create a

Branch: feat/create-a
Goal: Create a.
Specs:
- S1: a.txt exists
Allowed files:
- src/a.txt
Checks:
- test -f src/a.txt
`;

/** Behaves like the real agent: edits a file and commits it itself, in the worktree. */
const writingAgent: AgentRunner = {
  run: async (req) => {
    mkdirSync(join(req.cwd, "src"), { recursive: true });
    writeFileSync(join(req.cwd, "src/a.txt"), "a\n");
    git(req.cwd, "add", "-A");
    git(req.cwd, "commit", "-q", "-m", "feat(demo): add a");
    return { exitCode: 0, isError: false, resultText: "done", durationMs: 5, timedOut: false };
  },
};

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s: string) => void out.push(s), err: (s: string) => void err.push(s) }, out: () => out.join(""), err: () => err.join("") };
}

const deps = (): CliDeps => ({ agent: () => writingAgent, gitArgs: GIT_ARGS, cwd: scratch, env: { KNIT_HOME: dataDir } });

/** Runs the plan once, so there is a real run with a real branch and worktree to act on. */
async function runPlan(): Promise<{ runId: string; worktree: string; startSha: string }> {
  const plan = join(scratch, "plan.md");
  writeFileSync(plan, PLAN(repo));
  expect(await main(["run", plan], capture().io, deps())).toBe(0);
  const store = new SqliteRunStore(join(dataDir, "knit.db"));
  const run = store.listRuns()[0]!;
  const task = store.getRun(run.id)!.tasks[0]!;
  store.close();
  return { runId: run.id, worktree: task.worktree!, startSha: task.startSha! };
}

const branchExists = (): boolean => {
  try {
    git(repo, "show-ref", "--verify", "--quiet", "refs/heads/feat/create-a");
    return true;
  } catch {
    return false;
  }
};
const events = (runId: string): string[] => {
  const store = new SqliteRunStore(join(dataDir, "knit.db"));
  const types = store.getEvents(runId).map((e) => e.type);
  store.close();
  return types;
};

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "knit-branch-cli-"));
  repo = join(scratch, "target");
  dataDir = join(scratch, "data");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "hi\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "chore: init");
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe("knit branch undo", () => {
  it("without --yes only says what it would do, and changes nothing", async () => {
    const { runId, worktree } = await runPlan();
    const head = git(worktree, "rev-parse", "HEAD");
    const c = capture();
    expect(await main(["branch", runId, "T1", "undo", "--mode", "delete", "--json"], c.io, deps())).toBe(0);
    const out = JSON.parse(c.out().trim());
    expect(out).toMatchObject({ ok: true, dryRun: true, mode: "delete", branch: "feat/create-a" });
    expect(out.effects.join(" ")).toContain("feat/create-a");
    expect(git(worktree, "rev-parse", "HEAD")).toBe(head);
    expect(branchExists()).toBe(true);
    expect(events(runId)).not.toContain("branch.undone");
  });

  it("reverts with a new commit, keeping the history, and records it on the run", async () => {
    const { runId, worktree, startSha } = await runPlan();
    const before = Number(git(worktree, "rev-list", "--count", `${startSha}..HEAD`));
    const c = capture();
    expect(await main(["branch", runId, "T1", "undo", "--mode", "revert", "--yes", "--json"], c.io, deps())).toBe(0);
    expect(JSON.parse(c.out().trim())).toMatchObject({ ok: true, dryRun: false, mode: "revert" });
    expect(Number(git(worktree, "rev-list", "--count", `${startSha}..HEAD`))).toBe(before + 1);
    expect(existsSync(join(worktree, "src/a.txt"))).toBe(false);
    expect(events(runId)).toContain("branch.undone");
  });

  it("resets the branch to the start of the task", async () => {
    const { runId, worktree, startSha } = await runPlan();
    expect(await main(["branch", runId, "T1", "undo", "--mode", "reset", "--yes"], capture().io, deps())).toBe(0);
    expect(git(worktree, "rev-parse", "HEAD")).toBe(startSha);
    expect(branchExists()).toBe(true);
  });

  it("deletes the branch and its worktree", async () => {
    const { runId, worktree } = await runPlan();
    expect(await main(["branch", runId, "T1", "undo", "--mode", "delete", "--yes"], capture().io, deps())).toBe(0);
    expect(existsSync(worktree)).toBe(false);
    expect(branchExists()).toBe(false);
  });

  it("refuses with the reason and exit code 1, changing nothing, when the rules say no", async () => {
    const { runId } = await runPlan();
    await main(["branch", runId, "T1", "undo", "--mode", "delete", "--yes"], capture().io, deps());
    const c = capture();
    expect(await main(["branch", runId, "T1", "undo", "--mode", "revert", "--yes", "--json"], c.io, deps())).toBe(1);
    expect(JSON.parse(c.out().trim())).toMatchObject({ ok: false, reason: expect.stringContaining("no longer exists") });
  });

  it("exits 1 for a run or a task that does not exist, and 2 for a bad mode or a missing one", async () => {
    const { runId } = await runPlan();
    const a = capture();
    expect(await main(["branch", "nope", "T1", "undo", "--mode", "revert"], a.io, deps())).toBe(1);
    expect(a.err()).toContain("Run not found");
    const b = capture();
    expect(await main(["branch", runId, "T9", "undo", "--mode", "revert"], b.io, deps())).toBe(1);
    expect(b.err()).toContain("Task not found");
    const c = capture();
    expect(await main(["branch", runId, "T1", "undo", "--mode", "explode"], c.io, deps())).toBe(2);
    expect(await main(["branch", runId, "T1", "undo"], capture().io, deps())).toBe(2);
    expect(await main(["branch", runId, "T1", "frobnicate"], capture().io, deps())).toBe(2);
  });
});

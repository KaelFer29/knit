import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteRunStore } from "../../src/adapters/storage/sqlite/run-store.js";
import { main, type CliDeps } from "../../src/cli/main.js";
import type { AgentRunner } from "../../src/core/ports/agent-runner.js";
import type { CreatePullRequestInput, PullRequests } from "../../src/core/ports/pull-requests.js";
import type { AgentOptions } from "../../src/cli/types.js";

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

  it("never removes a worktree that is only reached through a symlink out of the run's directory", async () => {
    const { runId, worktree } = await runPlan();
    // Another worktree of the same repository, outside the run's directory, that must survive.
    const ext = join(scratch, "external");
    git(repo, "worktree", "add", "-q", "-b", "other", ext);
    writeFileSync(join(ext, "keep.txt"), "mine\n");
    const link = join(worktree, "..", "link");
    symlinkSync(ext, link);
    const store = new SqliteRunStore(join(dataDir, "knit.db"));
    store.upsertTask({ runId, taskId: "T1", title: "Create a", status: "passed", worktree: link });
    store.close();
    await main(["branch", runId, "T1", "undo", "--mode", "delete", "--yes"], capture().io, deps());
    expect(existsSync(join(ext, "keep.txt"))).toBe(true);
    expect(git(ext, "rev-parse", "--abbrev-ref", "HEAD")).toBe("other");
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

/** A Cursor stand-in that only writes text and remembers how it was asked. */
function draftAgent(answer: string, fail = false) {
  const seen: { options: AgentOptions[]; requests: { cwd: string; prompt: string; profile?: unknown }[] } = { options: [], requests: [] };
  const agent: AgentRunner = {
    run: async (req) => {
      seen.requests.push({ cwd: req.cwd, prompt: req.prompt, profile: req.profile });
      return fail
        ? { exitCode: 1, isError: true, resultText: "model exploded", durationMs: 1, timedOut: false }
        : { exitCode: 0, isError: false, resultText: answer, durationMs: 1, timedOut: false };
    },
  };
  return { seen, deps: (): CliDeps => ({ ...deps(), agent: (o) => (seen.options.push(o), agent) }) };
}

describe("knit branch pr-draft", () => {
  it("asks the cheap model for a title and a body from the task and its diff, in a scratch directory, and prints them", async () => {
    const { runId, worktree } = await runPlan();
    const d = draftAgent("Title: Add a.txt\n\n## Summary\n- adds the file");
    const c = capture();
    expect(await main(["branch", runId, "T1", "pr-draft", "--json"], c.io, d.deps())).toBe(0);
    expect(JSON.parse(c.out().trim())).toEqual({ ok: true, title: "Add a.txt", body: "## Summary\n- adds the file", model: "composer-2.5-fast" });
    expect(d.seen.options[0]).toMatchObject({ model: "composer-2.5-fast" });
    const req = d.seen.requests[0]!;
    expect(req.prompt).toContain("Create a");
    expect(req.prompt).toContain("src/a.txt");
    expect(req.prompt).toContain("+a");
    expect(req.cwd.startsWith(worktree)).toBe(false);
    expect(req.cwd.startsWith(repo)).toBe(false);
    expect(existsSync(req.cwd)).toBe(false);
  });

  it("uses the model it is given instead of the default", async () => {
    const { runId } = await runPlan();
    const d = draftAgent("Title: T\n\nB");
    expect(await main(["branch", runId, "T1", "pr-draft", "--model", "grok-4.7-high", "--json"], capture().io, d.deps())).toBe(0);
    expect(d.seen.options[0]).toMatchObject({ model: "grok-4.7-high" });
  });

  it("fails with the reason, and no draft, when the model fails", async () => {
    const { runId } = await runPlan();
    const c = capture();
    expect(await main(["branch", runId, "T1", "pr-draft", "--json"], c.io, draftAgent("", true).deps())).toBe(1);
    expect(JSON.parse(c.out().trim())).toMatchObject({ ok: false, reason: expect.stringContaining("model exploded") });
  });

  it("rejects a model id that could be read as an option, and calls nothing", async () => {
    const { runId } = await runPlan();
    for (const model of ["--force", "-x", "a b", ""]) {
      const d = draftAgent("Title: x\n\ny");
      expect(await main(["branch", runId, "T1", "pr-draft", `--model=${model}`], capture().io, d.deps()), model).toBe(2);
      expect(d.seen.requests).toHaveLength(0);
    }
  });

  it("refuses a branch that is gone, without calling the model", async () => {
    const { runId } = await runPlan();
    await main(["branch", runId, "T1", "undo", "--mode", "delete", "--yes"], capture().io, deps());
    const d = draftAgent("Title: x\n\ny");
    const c = capture();
    expect(await main(["branch", runId, "T1", "pr-draft", "--json"], c.io, d.deps())).toBe(1);
    expect(d.seen.requests).toHaveLength(0);
  });
});

describe("knit branch pr", () => {
  const calls: CreatePullRequestInput[] = [];
  let preflightError: string | undefined;
  const fakePrs: PullRequests = {
    preflight: () => {
      if (preflightError) throw new Error(preflightError);
    },
    create: (input) => {
      calls.push(input);
      return { url: "https://example.test/pull/7" };
    },
  };
  const withPrs = (): CliDeps => ({ ...deps(), pullRequests: fakePrs });
  let bare: string;
  beforeEach(() => {
    calls.length = 0;
    preflightError = undefined;
    bare = join(scratch, "origin.git");
    git(scratch, "init", "-q", "--bare", bare);
    git(repo, "remote", "add", "origin", bare);
  });

  it("pushes the branch, opens the pull request into the run's base with the given text, and remembers its address", async () => {
    const { runId } = await runPlan();
    const c = capture();
    expect(await main(["branch", runId, "T1", "pr", "--title", "Add a.txt", "--body", "## Summary\n- adds the file", "--json"], c.io, withPrs())).toBe(0);
    expect(JSON.parse(c.out().trim())).toMatchObject({ ok: true, url: "https://example.test/pull/7", base: "main", head: "feat/create-a" });
    expect(git(bare, "branch", "--list", "feat/create-a")).toContain("feat/create-a");
    expect(calls).toEqual([{ repo, head: "feat/create-a", base: "main", title: "Add a.txt", body: "## Summary\n- adds the file" }]);
    const store = new SqliteRunStore(join(dataDir, "knit.db"));
    expect(store.getRun(runId)!.tasks[0]!.prUrl).toBe("https://example.test/pull/7");
    store.close();
    expect(events(runId)).toContain("branch.pr_opened");
  });

  it("opens the pull request into the branch asked for with --base, and pushes without touching anything else", async () => {
    const { runId } = await runPlan();
    const c = capture();
    expect(await main(["branch", runId, "T1", "pr", "--title", "t", "--body", "b", "--base", "release/1.2", "--json"], c.io, withPrs())).toBe(0);
    expect(JSON.parse(c.out().trim())).toMatchObject({ ok: true, base: "release/1.2", head: "feat/create-a" });
    expect(calls).toEqual([{ repo, head: "feat/create-a", base: "release/1.2", title: "t", body: "b" }]);
  });

  it("refuses a --base that is not a branch name, or is the task's own branch, before pushing anything", async () => {
    const { runId } = await runPlan();
    expect(await main(["branch", runId, "T1", "pr", "--title", "t", "--body", "b", "--base", "a b"], capture().io, withPrs())).toBe(2);
    const c = capture();
    expect(await main(["branch", runId, "T1", "pr", "--title", "t", "--body", "b", "--base", "feat/create-a", "--json"], c.io, withPrs())).toBe(1);
    expect(JSON.parse(c.out().trim())).toMatchObject({ ok: false, reason: expect.stringContaining("its own branch") });
    expect(calls).toEqual([]);
    expect(git(bare, "branch", "--list")).toBe("");
  });

  it("takes a title or a body that starts with a dash when it is given as --title=... and --body=...", async () => {
    const { runId } = await runPlan();
    expect(await main(["branch", runId, "T1", "pr", "--title=-fix the typo", "--body=- adds the file", "--json"], capture().io, withPrs())).toBe(0);
    expect(calls[0]).toMatchObject({ title: "-fix the typo", body: "- adds the file" });
  });

  it("does not open a second one for the same task, and shows the first", async () => {
    const { runId } = await runPlan();
    await main(["branch", runId, "T1", "pr", "--title", "t", "--body", "b"], capture().io, withPrs());
    const c = capture();
    expect(await main(["branch", runId, "T1", "pr", "--title", "t", "--body", "b", "--json"], c.io, withPrs())).toBe(1);
    expect(JSON.parse(c.out().trim())).toMatchObject({ ok: false, reason: expect.stringContaining("https://example.test/pull/7") });
    expect(calls).toHaveLength(1);
  });

  it("checks that pull requests can be opened before it pushes anything", async () => {
    const { runId } = await runPlan();
    preflightError = "GitHub CLI is not logged in. Run: gh auth login";
    const c = capture();
    expect(await main(["branch", runId, "T1", "pr", "--title", "t", "--body", "b", "--json"], c.io, withPrs())).toBe(1);
    expect(JSON.parse(c.out().trim())).toMatchObject({ ok: false, reason: expect.stringContaining("not logged in") });
    expect(git(bare, "branch", "--list")).toBe("");
    expect(calls).toHaveLength(0);
  });

  it("opens no pull request when the push is rejected, and says why", async () => {
    const { runId, worktree } = await runPlan();
    git(worktree, "push", "-q", "origin", "feat/create-a");
    const other = join(scratch, "other");
    git(scratch, "clone", "-q", bare, other);
    git(other, "checkout", "-q", "feat/create-a");
    writeFileSync(join(other, "z.txt"), "z\n");
    git(other, "add", ".");
    git(other, "commit", "-qm", "feat: someone else");
    git(other, "push", "-q", "origin", "feat/create-a");
    writeFileSync(join(worktree, "src/b.txt"), "b\n");
    git(worktree, "add", "-A");
    git(worktree, "commit", "-qm", "feat: more");
    const c = capture();
    expect(await main(["branch", runId, "T1", "pr", "--title", "t", "--body", "b", "--json"], c.io, withPrs())).toBe(1);
    expect(JSON.parse(c.out().trim())).toMatchObject({ ok: false, reason: expect.stringMatching(/rejected|failed/i) });
    expect(calls).toHaveLength(0);
  });

  it("needs a title and a body, and rejects a title with a line break", async () => {
    const { runId } = await runPlan();
    expect(await main(["branch", runId, "T1", "pr", "--body", "b"], capture().io, withPrs())).toBe(2);
    expect(await main(["branch", runId, "T1", "pr", "--title", "t"], capture().io, withPrs())).toBe(2);
    expect(await main(["branch", runId, "T1", "pr", "--title", "a\nb", "--body", "b"], capture().io, withPrs())).toBe(2);
    expect(calls).toHaveLength(0);
  });
});

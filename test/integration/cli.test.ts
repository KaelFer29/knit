import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteRunStore } from "../../src/adapters/storage/sqlite/run-store.js";
import { main, type CliDeps } from "../../src/cli/main.js";
import type { AgentRunner } from "../../src/core/ports/agent-runner.js";
import type { CreatePullRequestInput, PullRequests } from "../../src/core/ports/pull-requests.js";

const GIT_ARGS = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null"];
const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", [...GIT_ARGS, ...args], { cwd, encoding: "utf8" }).trim();

let scratch: string;
let repo: string;
let dataDir: string;
let planPath: string;

const PLAN = (repoPath: string | undefined, check = "test -f src/a.txt") => `# Plan: demo plan

${repoPath ? `Repo: ${repoPath}\n` : ""}
## T1: Create a

Branch: feat/create-a
Goal: Create src/a.txt.
Specs:
- S1: Create the file src/a.txt
Allowed files:
- src/a.txt
Checks:
- ${check}
`;

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s: string) => void out.push(s), err: (s: string) => void err.push(s) }, out, err, text: () => out.join("") + err.join("") };
}

/** Behaves like the real agent: edits files and commits them itself, in the worktree. */
const writingAgent: AgentRunner = {
  run: async (req, onEvent) => {
    onEvent?.({ type: "thinking", raw: { type: "thinking", subtype: "delta", text: "Plan the edit" } });
    onEvent?.({ type: "thinking", raw: { type: "thinking", subtype: "completed" } });
    onEvent?.({ type: "assistant", raw: { type: "assistant", message: { content: [{ type: "text", text: "Creating the file" }] } } });
    onEvent?.({ type: "tool_call", raw: { type: "tool_call", subtype: "started", call_id: "c1", tool_call: { shellToolCall: { args: { command: "echo hi" } } } } });
    onEvent?.({ type: "tool_call", raw: { type: "tool_call", subtype: "completed", call_id: "c1", tool_call: { shellToolCall: { result: { stdout: "hi" } } } } });
    mkdirSync(join(req.cwd, "src"), { recursive: true });
    writeFileSync(join(req.cwd, "src/a.txt"), "a\n");
    if (git(req.cwd, "status", "--porcelain") !== "") {
      git(req.cwd, "add", "-A");
      git(req.cwd, "commit", "-q", "-m", "feat(demo): add a");
    }
    return { exitCode: 0, isError: false, resultText: "done", durationMs: 5, inputTokens: 10, outputTokens: 3, sessionId: "s1", timedOut: false };
  },
};

const prCalls: CreatePullRequestInput[] = [];
const fakePrs: PullRequests = {
  preflight: () => {},
  create: (input) => {
    prCalls.push(input);
    return { url: "https://example.test/pull/1" };
  },
};

const baseDeps = (): CliDeps => ({
  agent: () => writingAgent,
  pullRequests: fakePrs,
  gitArgs: GIT_ARGS,
  cwd: scratch,
  env: { KNIT_HOME: dataDir },
});

const runIdOf = async (): Promise<string> => {
  const list = capture();
  await main(["runs"], list.io, baseDeps());
  return /(demo-plan-[\w-]+)/.exec(list.out.join(""))![1]!;
};

beforeEach(() => {
  prCalls.length = 0;
  scratch = mkdtempSync(join(tmpdir(), "orq-cli-"));
  repo = join(scratch, "target");
  dataDir = join(scratch, "data");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "hi\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "chore: init");
  planPath = join(scratch, "plan.md");
  writeFileSync(planPath, PLAN(repo));
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe("cli usage and validate", () => {
  it("prints usage and exits 2 without a command", async () => {
    const c = capture();
    expect(await main([], c.io, baseDeps())).toBe(2);
    expect(c.err.join("")).toContain("Usage:");
  });

  it("exits 2 on an unknown command", async () => {
    const c = capture();
    expect(await main(["bogus"], c.io, baseDeps())).toBe(2);
    expect(c.err.join("")).toContain("Unknown command: bogus");
  });

  it("validates a good plan", async () => {
    const c = capture();
    expect(await main(["validate", planPath], c.io, baseDeps())).toBe(0);
    expect(c.out.join("")).toContain("OK: plan 'demo plan' with 1 task");
  });

  it("reports every issue of a bad plan and exits 2", async () => {
    writeFileSync(planPath, "# Plan: x\n\n## T1: A\n");
    const c = capture();
    expect(await main(["validate", planPath], c.io, baseDeps())).toBe(2);
    expect(c.err.join("")).toContain("T1: missing Specs");
    expect(c.err.join("")).toContain("T1: missing 'Branch:'");
  });

  it("exits 2 when the plan file does not exist", async () => {
    const c = capture();
    expect(await main(["validate", join(scratch, "nope.md")], c.io, baseDeps())).toBe(2);
    expect(c.err.join("")).toContain("Cannot read plan");
  });
});

describe("cli run", () => {
  it("dry-run prints the prompts and touches nothing", async () => {
    const c = capture();
    expect(await main(["run", planPath, "--dry-run"], c.io, baseDeps())).toBe(0);
    expect(c.out.join("")).toContain("Task: T1 - Create a");
    expect(c.out.join("")).toContain("You are on branch feat/create-a");
    expect(existsSync(dataDir)).toBe(false);
    expect(git(repo, "worktree", "list").split("\n")).toHaveLength(1);
  });

  it("runs a plan end to end on the plan's branch with the agent's own commits", async () => {
    const c = capture();
    expect(await main(["run", planPath], c.io, baseDeps())).toBe(0);
    expect(c.out.join("")).toContain("passed");
    expect(git(repo, "branch", "--list", "feat/create-a")).toContain("feat/create-a");
    expect(existsSync(join(repo, "src/a.txt"))).toBe(false); // main checkout untouched
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(repo, "show", "feat/create-a:src/a.txt")).toBe("a");
    expect(git(repo, "log", "-1", "--format=%s", "feat/create-a")).toBe("feat(demo): add a");

    const runId = await runIdOf();
    const show = capture();
    expect(await main(["show", runId], show.io, baseDeps())).toBe(0);
    const text = show.out.join("");
    expect(text).toContain("passed");
    expect(text).toContain("T1");
    expect(text).toContain("attempt 1");
    expect(text).toContain("10 in / 3 out");
    expect(text).toContain("branch feat/create-a");
  });

  it("records the plan snapshot of the run in the database", async () => {
    expect(await main(["run", planPath], capture().io, baseDeps())).toBe(0);
    const store = new SqliteRunStore(join(dataDir, "knit.db"));
    try {
      const { run, tasks } = store.getRun(await runIdOf())!;
      expect(run.planText).toBe(readFileSync(planPath, "utf8"));
      expect(run.pid).toBeUndefined(); // finished runs hold no pid
      expect(tasks[0]).toMatchObject({
        goal: "Create src/a.txt.",
        position: 1,
        specs: [{ id: "S1", text: "Create the file src/a.txt" }],
      });
      expect(store.getAgentEvents(run.id).every((e) => e.agent === "cursor")).toBe(true);
    } finally {
      store.close();
    }
  });

  it("uses the repository of the current directory when the plan has no Repo", async () => {
    writeFileSync(planPath, PLAN(undefined));
    const c = capture();
    expect(await main(["run", planPath], c.io, { ...baseDeps(), cwd: join(repo) })).toBe(0);
    expect(git(repo, "branch", "--list", "feat/create-a")).toContain("feat/create-a");
  });

  it("exits 2 when the plan has no Repo and the current directory is not a repository", async () => {
    writeFileSync(planPath, PLAN(undefined));
    const c = capture();
    expect(await main(["run", planPath], c.io, baseDeps())).toBe(2);
    expect(c.err.join("")).toContain("not inside a git repository");
  });

  it("exits 1 and reports the reason when a task fails", async () => {
    writeFileSync(planPath, PLAN(repo, "false"));
    const c = capture();
    expect(await main(["run", planPath, "--max-attempts", "1"], c.io, baseDeps())).toBe(1);
    expect(c.text()).toContain("Check failed: false");
  });

  it("exits 2 with a clear message when the repo or base cannot be resolved", async () => {
    mkdirSync(join(scratch, "not-a-repo"));
    writeFileSync(planPath, PLAN(join(scratch, "not-a-repo")));
    const c = capture();
    expect(await main(["run", planPath], c.io, baseDeps())).toBe(2);
    expect(c.err.join("")).toMatch(/Cannot resolve base|not a git repository/);
  });

  it("rejects invalid numeric options", async () => {
    const c = capture();
    expect(await main(["run", planPath, "--max-attempts", "zero"], c.io, baseDeps())).toBe(2);
    expect(c.err.join("")).toContain("--max-attempts");
  });
});

describe("cli push and pull requests", () => {
  const addOrigin = (): string => {
    const bare = join(scratch, "origin.git");
    execFileSync("git", ["init", "-q", "--bare", bare]);
    git(repo, "remote", "add", "origin", bare);
    return bare;
  };

  it("pushes the branch and opens a PR against the base branch with --pr", async () => {
    const bare = addOrigin();
    const c = capture();
    expect(await main(["run", planPath, "--pr"], c.io, baseDeps())).toBe(0);
    expect(git(bare, "rev-parse", "feat/create-a")).toBe(git(repo, "rev-parse", "feat/create-a"));
    expect(prCalls).toHaveLength(1);
    expect(prCalls[0]).toMatchObject({ head: "feat/create-a", base: "main", title: "feat: Create a", repo });
    expect(c.out.join("")).toContain("https://example.test/pull/1");
    const show = capture();
    await main(["show", await runIdOf()], show.io, baseDeps());
    expect(show.out.join("")).toContain("https://example.test/pull/1");
  });

  it("only pushes with --push", async () => {
    const bare = addOrigin();
    expect(await main(["run", planPath, "--push"], capture().io, baseDeps())).toBe(0);
    expect(git(bare, "branch", "--list", "feat/create-a")).toContain("feat/create-a");
    expect(prCalls).toEqual([]);
  });

  it("exits 2 before doing any work when PRs cannot be opened", async () => {
    const failing: PullRequests = { preflight: () => { throw new Error("GitHub CLI is not logged in. Run: gh auth login"); }, create: () => ({ url: "x" }) };
    const c = capture();
    expect(await main(["run", planPath, "--pr"], c.io, { ...baseDeps(), pullRequests: failing })).toBe(2);
    expect(c.err.join("")).toContain("gh auth login");
    expect(git(repo, "branch", "--list", "feat/*")).toBe("");
  });

  it("prints delivery warnings but still exits 0 when the task passed", async () => {
    const c = capture();
    // No origin remote: the push fails, the run itself passed.
    expect(await main(["run", planPath, "--push"], c.io, baseDeps())).toBe(0);
    expect(c.text()).toContain("WARNING");
    expect(c.text()).toContain("T1: push failed");
  });
});

describe("cli resume and clean", () => {
  it("resumes a failed run, reusing the kept worktree and numbering attempts on", async () => {
    const flag = join(scratch, "flag");
    writeFileSync(planPath, PLAN(repo, `test -f ${flag}`));
    expect(await main(["run", planPath, "--max-attempts", "1"], capture().io, baseDeps())).toBe(1);
    const runId = await runIdOf();

    writeFileSync(flag, "ok");
    const c = capture();
    expect(await main(["resume", runId, "--max-attempts", "1"], c.io, baseDeps())).toBe(0);
    expect(c.out.join("")).toContain("passed");

    const show = capture();
    await main(["show", runId], show.io, baseDeps());
    const text = show.out.join("");
    expect(text).toContain("attempt 1  failed");
    expect(text).toContain("attempt 2  passed");
    expect(git(repo, "worktree", "list").split("\n")).toHaveLength(2); // main + the one task worktree, reused
  });

  it("exits 1 when resuming an unknown run", async () => {
    mkdirSync(dataDir);
    const c = capture();
    expect(await main(["resume", "nope"], c.io, baseDeps())).toBe(1);
    expect(c.err.join("")).toContain("Run not found: nope");
  });

  it("clean removes the worktrees and keeps the branches unless they are merged", async () => {
    expect(await main(["run", planPath], capture().io, baseDeps())).toBe(0);
    const runId = await runIdOf();
    expect(git(repo, "worktree", "list").split("\n")).toHaveLength(2);

    const c = capture();
    expect(await main(["clean", runId, "--delete-branches"], c.io, baseDeps())).toBe(0);
    expect(git(repo, "worktree", "list").split("\n")).toHaveLength(1);
    expect(existsSync(join(dataDir, "worktrees", runId))).toBe(false);
    expect(c.out.join("")).toContain("kept (not merged): feat/create-a");
    expect(git(repo, "branch", "--list", "feat/create-a")).toContain("feat/create-a");

    git(repo, "merge", "-q", "--no-edit", "feat/create-a");
    const again = capture();
    expect(await main(["clean", runId, "--delete-branches"], again.io, baseDeps())).toBe(0);
    expect(again.out.join("")).toContain("deleted branch: feat/create-a");
    expect(git(repo, "branch", "--list", "feat/create-a")).toBe("");
  });

  it("clean exits 1 for an unknown run", async () => {
    mkdirSync(dataDir);
    const c = capture();
    expect(await main(["clean", "nope"], c.io, baseDeps())).toBe(1);
    expect(c.err.join("")).toContain("Run not found: nope");
  });
});

describe("cli logs", () => {
  it("prints the agent's full timeline: thinking, messages and tool calls with arguments and results", async () => {
    await main(["run", planPath], capture().io, baseDeps());
    const runId = await runIdOf();
    const c = capture();
    expect(await main(["logs", runId], c.io, baseDeps())).toBe(0);
    const text = c.out.join("");
    expect(text).toContain("[T1#1]");
    expect(text).toMatch(/thinking\s+Plan the edit/);
    expect(text).toMatch(/message\s+Creating the file/);
    expect(text).toMatch(/tool ▶\s+shellToolCall .*echo hi/);
    expect(text).toMatch(/tool ✓\s+shellToolCall .*hi/);
  });

  it("filters by task and says so when there is nothing", async () => {
    await main(["run", planPath], capture().io, baseDeps());
    const runId = await runIdOf();
    const none = capture();
    expect(await main(["logs", runId, "--task", "T9"], none.io, baseDeps())).toBe(0);
    expect(none.out.join("")).toContain("No events");
    const some = capture();
    await main(["logs", runId, "--task", "T1"], some.io, baseDeps());
    expect(some.out.join("")).toContain("Creating the file");
  });

  it("keeps the raw stream of each attempt on disk", async () => {
    await main(["run", planPath], capture().io, baseDeps());
    const runId = await runIdOf();
    const file = join(dataDir, "logs", runId, "T1-attempt-1.jsonl");
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(5);
    expect(JSON.parse(lines[2]!)).toMatchObject({ type: "assistant" });
  });

  it("--follow returns once the run is finished", async () => {
    await main(["run", planPath], capture().io, baseDeps());
    const runId = await runIdOf();
    const c = capture();
    expect(await main(["logs", runId, "--follow"], c.io, { ...baseDeps(), sleep: async () => {} })).toBe(0);
    expect(c.out.join("")).toContain("Creating the file");
  });

  it("exits 1 for an unknown run", async () => {
    mkdirSync(dataDir);
    const c = capture();
    expect(await main(["logs", "nope"], c.io, baseDeps())).toBe(1);
    expect(c.err.join("")).toContain("Run not found: nope");
  });
});

describe("cli show and runs", () => {
  it("exits 1 for an unknown run id", async () => {
    mkdirSync(dataDir);
    const c = capture();
    expect(await main(["show", "nope"], c.io, baseDeps())).toBe(1);
    expect(c.err.join("")).toContain("Run not found: nope");
  });

  it("says so when there are no runs", async () => {
    const c = capture();
    expect(await main(["runs"], c.io, baseDeps())).toBe(0);
    expect(c.out.join("")).toContain("No runs yet");
  });
});

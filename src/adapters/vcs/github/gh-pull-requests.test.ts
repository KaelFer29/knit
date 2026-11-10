import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GhPullRequests } from "./gh-pull-requests.js";

const here = dirname(fileURLToPath(import.meta.url));
let scratch: string;
let repo: string;
let log: string;

const gh = (env: Record<string, string> = {}) =>
  new GhPullRequests({
    command: process.execPath,
    prefixArgs: [join(here, "__fixtures__/fake-gh.mjs")],
    env: { FAKE_GH_LOG: log, ...env },
  });

const INPUT = { head: "feat/one", base: "main", title: "feat: One", body: "Body text" };

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "orq-gh-"));
  repo = join(scratch, "repo");
  log = join(scratch, "gh.log");
  mkdirSync(repo);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/demo.git"], { cwd: repo });
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe("GhPullRequests.preflight", () => {
  it("passes when gh is logged in and the repo has an origin", () => {
    expect(() => gh().preflight(repo)).not.toThrow();
  });

  it("explains how to log in when gh is not authenticated", () => {
    expect(() => gh({ FAKE_GH_AUTH: "0" }).preflight(repo)).toThrow(/gh auth login/);
  });

  it("explains a missing origin remote", () => {
    execFileSync("git", ["remote", "remove", "origin"], { cwd: repo });
    expect(() => gh().preflight(repo)).toThrow(/origin/);
  });

  it("explains a missing gh binary", () => {
    const missing = new GhPullRequests({ command: "definitely-not-gh-xyz" });
    expect(() => missing.preflight(repo)).toThrow(/not installed/);
  });
});

describe("GhPullRequests.create", () => {
  it("opens the PR with head, base, title and body and returns its URL", () => {
    const r = gh().create({ repo, ...INPUT });
    expect(r.url).toBe("https://github.com/acme/demo/pull/7");
    const call = JSON.parse(readFileSync(log, "utf8").trim().split("\n").at(-1)!) as string[];
    expect(call).toEqual(
      expect.arrayContaining(["pr", "create", "--head", "feat/one", "--base", "main", "--title", "feat: One", "--body", "Body text"]),
    );
  });

  it("returns the existing PR when one already exists for the branch", () => {
    expect(gh({ FAKE_GH_MODE: "exists" }).create({ repo, ...INPUT }).url).toBe("https://github.com/acme/demo/pull/3");
  });

  it("throws with gh's message on any other failure", () => {
    expect(() => gh({ FAKE_GH_MODE: "fail" }).create({ repo, ...INPUT })).toThrow(/not allowed/);
  });
});

describe("GhPullRequests.status", () => {
  const URL_ = "https://github.com/acme/demo/pull/7";

  it("reads whether the PR is open, merged or closed, and the branch it targets", () => {
    expect(gh({ FAKE_GH_PR_STATE: "MERGED", FAKE_GH_PR_BASE: "release/1.2" }).status(repo, URL_)).toEqual({ state: "merged", base: "release/1.2", headSha: "abc1234" });
    expect(gh({ FAKE_GH_PR_STATE: "CLOSED" }).status(repo, URL_)).toEqual({ state: "closed", base: "main", headSha: "abc1234" });
    expect(gh().status(repo, URL_)).toEqual({ state: "open", base: "main", headSha: "abc1234" });
  });

  it("asks gh for the PR at that address, not for the branch", () => {
    gh().status(repo, URL_);
    const call = JSON.parse(readFileSync(log, "utf8").trim().split("\n").at(-1)!) as string[];
    expect(call).toEqual(["pr", "view", URL_, "--json", "state,baseRefName,headRefOid"]);
  });

  it("throws with gh's message when it cannot read the PR", () => {
    expect(() => gh({ FAKE_GH_VIEW_FAIL: "1" }).status(repo, "https://github.com/acme/demo/pull/999")).toThrow(/Could not resolve/);
  });
});

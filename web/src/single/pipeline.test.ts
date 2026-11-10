import { describe, expect, it } from "vitest";
import { deliveredRun, failedRun, retryingRun, runningRun, verifyingRun } from "../fixtures/boards";
import { clipLine, deriveBlocks, deriveDetails, deriveHops, deriveStages, hopProgress, type SessionGlimpse } from "./pipeline";

const hop = (hops: ReturnType<typeof deriveHops>, id: string) => hops.find((h) => h.id === id)!;
const claudeBusy: SessionGlimpse = { id: "s1", status: "running", title: "Plan billing", lastPrompt: "Write the plan for webhooks", lines: ["Reading the repo"] };

describe("deriveHops", () => {
  it("is idle on all three hops with no board and no session", () => {
    const hops = deriveHops(undefined, undefined);
    expect(hops.map((h) => [h.id, h.status, h.stage])).toEqual([
      ["plan", "idle", "Waiting for a plan"],
      ["prompt", "idle", "No task queued"],
      ["result", "idle", "No result yet"],
    ]);
    expect(hops.every((h) => h.lines.length === 0)).toBe(true);
  });

  it("shows the plan being drafted while a Claude turn runs and no run exists", () => {
    const plan = hop(deriveHops(undefined, claudeBusy), "plan");
    expect(plan.status).toBe("active");
    expect(plan.stage).toBe("Plan drafted");
    expect(plan.lines[0]).toContain("Write the plan for webhooks");
  });

  it("says the plan arrived and tasks are queued once a run exists", () => {
    const plan = hop(deriveHops(runningRun, undefined), "plan");
    expect(plan.stage).toBe("Tasks queued");
    expect(plan.status).toBe("done");
    expect(plan.lines).toContain("add-billing-webhooks: 6 tasks");
  });

  it("follows the active task on the prompt hop: prompt sent, then agent working with the live line", () => {
    const prompt = hop(deriveHops(runningRun, undefined), "prompt");
    expect(prompt.status).toBe("active");
    expect(prompt.stage).toBe("Agent working");
    expect(prompt.lines[0]).toContain("T3");
    expect(prompt.lines.join("\n")).toContain("edit: src/billing/webhook-store.ts");
    const sent = hop(deriveHops({ ...runningRun, liveLine: undefined }, undefined), "prompt");
    expect(sent.stage).toBe("Prompt sent");
  });

  it("queues the next task when nothing is active", () => {
    const { active: _active, ...board } = runningRun;
    expect(hop(deriveHops(board, undefined), "prompt").stage).toBe("Task queued");
  });

  it("shows checks running on the result hop while verifying", () => {
    const result = hop(deriveHops(verifyingRun, undefined), "result");
    expect(result.status).toBe("active");
    expect(result.stage).toBe("Checks running");
    expect(result.lines.join("\n")).toContain("pnpm typecheck");
  });

  it("reports a failed check and a retry as the verdict", () => {
    const result = hop(deriveHops(retryingRun, undefined), "result");
    expect(result.stage).toBe("Verdict: retry");
    expect(result.lines.join("\n")).toMatch(/check failed/i);
  });

  it("ends with a verdict: delivered run is done, failed run is failed", () => {
    expect(hop(deriveHops(deliveredRun, undefined), "result")).toMatchObject({ stage: "Verdict: delivered", status: "done" });
    expect(hop(deriveHops(failedRun, undefined), "result")).toMatchObject({ stage: "Verdict: failed", status: "failed" });
  });

  it("keeps at most three short lines per hop", () => {
    for (const h of deriveHops(runningRun, claudeBusy)) {
      expect(h.lines.length).toBeLessThanOrEqual(3);
      expect(h.lines.every((l) => l.length <= 72)).toBe(true);
    }
  });
});

describe("deriveBlocks", () => {
  it("describes Claude from the session, Knit from the run and Cursor from the active attempt", () => {
    const blocks = deriveBlocks(runningRun, claudeBusy);
    expect(blocks.claude).toMatchObject({ status: "working", headline: "Plan billing" });
    expect(blocks.claude.lines).toEqual(["Reading the repo"]);
    expect(blocks.knit).toMatchObject({ status: "working", headline: "add-billing-webhooks" });
    expect(blocks.knit.lines[0]).toBe("2 of 6 tasks delivered");
    expect(blocks.cursor).toMatchObject({ status: "working", headline: "T3" });
    expect(blocks.cursor.lines[0]).toContain("Attempt 1");
  });

  it("falls back to the board's plan when there is no session, and to idle blocks without a board", () => {
    expect(deriveBlocks(runningRun, undefined).claude.headline).toBe("add-billing-webhooks");
    const idle = deriveBlocks(undefined, undefined);
    expect(idle.claude).toMatchObject({ status: "idle", headline: "No session yet" });
    expect(idle.knit).toMatchObject({ status: "idle", headline: "No run yet" });
    expect(idle.cursor).toMatchObject({ status: "idle", headline: "Nothing to build" });
  });
});

describe("clipLine and hopProgress", () => {
  it("cuts long lines at a word boundary with an ellipsis", () => {
    const out = clipLine("Reading the repository structure before drafting the billing webhook plan for the team", 40);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out).toBe("Reading the repository structure…");
  });
  it("keeps short lines and cuts a single long word", () => {
    expect(clipLine("short  line", 40)).toBe("short line");
    expect(clipLine("x".repeat(50), 10)).toBe(`${"x".repeat(9)}…`);
  });
  it("reports how many stages a hop has reached", () => {
    expect(hopProgress({ stages: ["a", "b", "c", "d"], stageIndex: -1 })).toBe(0);
    expect(hopProgress({ stages: ["a", "b", "c", "d"], stageIndex: 1 })).toBe(0.5);
    expect(hopProgress({ stages: ["a", "b"], stageIndex: 5 })).toBe(1);
  });
});

describe("deriveStages", () => {
  const view = (board: Parameters<typeof deriveStages>[0]) => deriveStages(board).map((s) => `${s.id}:${s.status}`);

  it("lists the orchestrator's five stages in order, all idle with no run", () => {
    const stages = deriveStages(undefined);
    expect(stages.map((s) => s.label)).toEqual(["Plan", "Queue", "Build", "Checks", "Deliver"]);
    expect(stages.every((s) => s.status === "idle")).toBe(true);
  });

  it("marks the build stage active while Cursor works, with the task and the delivered count", () => {
    expect(view(runningRun)).toEqual(["plan:done", "queue:active", "build:active", "checks:idle", "deliver:active"]);
    const stages = deriveStages(runningRun);
    expect(stages.find((s) => s.id === "build")!.detail).toBe("T3 · attempt 1");
    expect(stages.find((s) => s.id === "deliver")!.detail).toBe("2 of 6");
  });

  it("moves to the checks stage while checks run, and keeps it active on a retry", () => {
    expect(deriveStages(verifyingRun).find((s) => s.id === "checks")!.status).toBe("active");
    expect(deriveStages(verifyingRun).find((s) => s.id === "build")!.status).toBe("done");
    expect(deriveStages(retryingRun).find((s) => s.id === "checks")!.status).toBe("active");
  });

  it("fails the checks stage when the run ended on a failed task", () => {
    expect(deriveStages(failedRun).find((s) => s.id === "checks")!.status).toBe("failed");
  });

  it("finishes every stage when the whole plan is delivered", () => {
    expect(view(deliveredRun)).toEqual(["plan:done", "queue:done", "build:done", "checks:done", "deliver:done"]);
  });
});

describe("deriveDetails", () => {
  const session: SessionGlimpse = {
    id: "s1",
    status: "running",
    title: "Plan billing",
    lines: [],
    model: "claude-opus-5-5",
    contextTokens: 48_200,
    turns: 3,
    agents: ["Map the server"],
    planUsage: [{ name: "five_hour", utilization: 0.42 }],
  };
  const fact = (facts: { label: string; value: string }[], label: string) => facts.find((f) => f.label === label)?.value;

  it("shows Claude's model, context, turns, running agents and plan usage from the session", () => {
    const { claude } = deriveDetails(runningRun, session);
    expect(fact(claude.facts, "Model")).toBe("claude-opus-5-5");
    expect(fact(claude.facts, "Context")).toBe("48.2k tokens");
    expect(fact(claude.facts, "Turns")).toBe("3");
    expect(claude.agents).toEqual(["Map the server"]);
    expect(claude.meters).toEqual([{ label: "5-hour limit", ratio: 0.42 }]);
  });

  it("says what is unknown instead of inventing it when there is no session", () => {
    const { claude } = deriveDetails(runningRun, undefined);
    expect(fact(claude.facts, "Model")).toBe("No session");
    expect(fact(claude.facts, "Plan")).toBe("add-billing-webhooks");
    expect(claude.agents).toEqual([]);
  });

  it("shows the run for the orchestrator and the active attempt for Cursor", () => {
    const { knit, cursor } = deriveDetails(runningRun, undefined);
    expect(fact(knit.facts, "Run")).toBe("running");
    expect(fact(knit.facts, "Tasks")).toBe("2 of 6 delivered");
    expect(fact(cursor.facts, "Task")).toBe("T3");
    expect(fact(cursor.facts, "Attempt")).toBe("1");
    expect(fact(cursor.facts, "Tokens")).toMatch(/k$|^\d+$/);
  });

  it("has nothing for the orchestrator and Cursor without a run", () => {
    const { knit, cursor } = deriveDetails(undefined, undefined);
    expect(fact(knit.facts, "Run")).toBe("No run yet");
    expect(cursor.facts).toEqual([{ label: "Task", value: "None" }]);
  });
});

describe("block models", () => {
  it("names Claude's model and Cursor's, in place of a status that says nothing", () => {
    const blocks = deriveBlocks(runningRun, claudeBusy);
    expect(blocks.claude.model).toBe("Default");
    const sonnet = deriveBlocks(runningRun, { ...claudeBusy, model: "claude-sonnet-5-5" });
    expect(sonnet.claude.model).toBe("Sonnet 5.5");
  });

  it("names the model of the task Cursor is on, then of the last task, then the agent's default", () => {
    const withModel = (ids: Record<string, string>) => ({ ...runningRun, tasks: runningRun.tasks.map((t) => (ids[t.taskId] ? { ...t, model: ids[t.taskId] } : t)) });
    const active = withModel({ T3: "grok-4.7", T6: "composer-2.5-fast" });
    expect(deriveBlocks(active, claudeBusy).cursor.model).toBe("grok-4.7");
    // Nothing active: the last task of the plan is the one Cursor was given last.
    const done = { ...active, active: undefined, tasks: active.tasks.map((t) => ({ ...t, state: "delivered" as const })) };
    expect(deriveBlocks(done as typeof runningRun, undefined).cursor.model).toBe("composer-2.5-fast");
    expect(deriveBlocks({ ...runningRun, tasks: runningRun.tasks.map((t) => ({ ...t, model: undefined })) }, undefined).cursor.model).toBe("Default");
  });
});

describe("live plan usage", () => {
  it("draws the meters from the live windows when they are given, so they do not wait for the next turn", () => {
    const live = [{ label: "Current session", percent: 67 }];
    expect(deriveDetails(runningRun, claudeBusy, live).claude.meters).toEqual([{ label: "Current session", ratio: 0.67 }]);
    const stored = { ...claudeBusy, planUsage: [{ name: "five_hour", utilization: 0.42 }] };
    expect(deriveDetails(runningRun, stored).claude.meters).toEqual([expect.objectContaining({ ratio: 0.42 })]);
  });
});

describe("Cursor's context in the block details", () => {
  const context = { taskId: "T3", attempt: 1, tokens: 100_000, window: 200_000, share: 0.5, assumedWindow: true };

  it("adds a Context fact and a meter when the chat was measured", () => {
    const { cursor } = deriveDetails({ ...runningRun, context }, undefined);
    expect(cursor.facts).toContainEqual({ label: "Context", value: "100k of 200k" });
    expect(cursor.meters).toEqual([{ label: "Context", ratio: 0.5 }]);
  });

  it("adds nothing when it was not", () => {
    const { cursor } = deriveDetails(runningRun, undefined);
    expect(cursor.facts.some((f) => f.label === "Context")).toBe(false);
    expect(cursor.meters).toEqual([]);
  });
});

describe("long model ids on the blocks", () => {
  it("show a parameterized model with dashes, never in brackets", () => {
    const board = { ...runningRun, tasks: runningRun.tasks.map((t) => (t.taskId === "T3" ? { ...t, model: "claude-opus-4-8[context=1m,effort=high,fast=false]" } : t)) };
    expect(deriveBlocks(board, claudeBusy).cursor.model).toBe("claude-opus-4-8-1m-high");
    expect(deriveBlocks(runningRun, { ...claudeBusy, model: "composer-2[context=1m]" }).claude.model).toBe("composer-2-1m");
  });
});


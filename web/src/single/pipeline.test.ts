import { describe, expect, it } from "vitest";
import { deliveredRun, failedRun, retryingRun, runningRun, verifyingRun } from "../fixtures/boards";
import { deriveBlocks, deriveHops, type SessionGlimpse } from "./pipeline";

const hop = (hops: ReturnType<typeof deriveHops>, id: string) => hops.find((h) => h.id === id)!;
const claudeBusy: SessionGlimpse = { status: "running", title: "Plan billing", lastPrompt: "Write the plan for webhooks", lines: ["Reading the repo"] };

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

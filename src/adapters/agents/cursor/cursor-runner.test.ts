import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CursorAgentRunner } from "./cursor-runner.js";
import type { AgentEvent } from "../../../core/ports/agent-runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const runner = new CursorAgentRunner({
  command: process.execPath,
  prefixArgs: [join(here, "__fixtures__/fake-agent.mjs")],
  killGraceMs: 200,
});

const run = (mode: string, timeoutMs = 10_000, onEvent?: (e: AgentEvent) => void) =>
  runner.run({ cwd: here, prompt: `do it MODE:${mode}`, timeoutMs }, onEvent);

describe("CursorAgentRunner", () => {
  it("maps a successful stream to an AgentRunResult", async () => {
    const r = await run("ok");
    expect(r).toMatchObject({
      exitCode: 0,
      isError: false,
      resultText: "done",
      inputTokens: 100,
      outputTokens: 20,
      sessionId: "sess-1",
      timedOut: false,
    });
    expect(r.durationMs).toBeGreaterThan(0);
  });

  it("passes the headless flags, the prompt as last arg, and runs in the given cwd", async () => {
    const events: AgentEvent[] = [];
    await run("ok", 10_000, (e) => events.push(e));
    const init = events.find((e) => e.type === "system")!.raw as { argv: string[]; cwd: string };
    expect(init.argv).toEqual(expect.arrayContaining(["-p", "--force", "--output-format", "stream-json"]));
    expect(init.argv.at(-1)).toContain("MODE:ok");
    expect(init.cwd).toBe(here);
  });

  it("forwards every parsed event in order and ignores non-JSON lines", async () => {
    const events: AgentEvent[] = [];
    await run("ok", 10_000, (e) => events.push(e));
    expect(events.map((e) => e.type)).toEqual(["system", "tool_call", "tool_call", "result"]);
    const g: AgentEvent[] = [];
    const r = await run("garbage", 10_000, (e) => g.push(e));
    expect(g.map((e) => e.type)).toEqual(["system", "result"]);
    expect(r.isError).toBe(false);
    expect(r.resultText).toBe("still fine");
  });

  it("reports an error result with a non-zero exit code", async () => {
    const r = await run("error");
    expect(r).toMatchObject({ exitCode: 1, isError: true, resultText: "model exploded" });
  });

  it("reports a crash without a result using stderr as the text", async () => {
    const r = await run("crash");
    expect(r.exitCode).toBe(3);
    expect(r.isError).toBe(true);
    expect(r.resultText).toContain("fatal: something broke");
  });

  it("treats a clean exit without a result event as an error", async () => {
    const r = await run("noresult");
    expect(r.exitCode).toBe(0);
    expect(r.isError).toBe(true);
    expect(r.resultText).toContain("no result");
  });

  it("kills a hanging agent on timeout", async () => {
    const started = Date.now();
    const r = await run("hang", 400);
    expect(r.timedOut).toBe(true);
    expect(r.isError).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("reports a missing binary instead of throwing", async () => {
    const missing = new CursorAgentRunner({ command: "definitely-not-a-real-binary-xyz" });
    const r = await missing.run({ cwd: here, prompt: "x", timeoutMs: 5000 });
    expect(r.isError).toBe(true);
    expect(r.exitCode).toBeNull();
    expect(r.resultText).toContain("definitely-not-a-real-binary-xyz");
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CursorAgentRunner } from "./cursor-runner.js";
import { capabilitiesOf, type AgentEvent, type AgentRunRequest, type AgentRunner } from "../../../core/ports/agent-runner.js";

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

  it("reports the context the chat carries: fresh input plus what it read from and wrote to the cache", async () => {
    expect((await run("ok")).contextTokens).toBe(1050);
  });

  it("reports no context when the result carries no usage", async () => {
    const r = await run("garbage");
    expect(r.contextTokens).toBeUndefined();
    expect(r.inputTokens).toBeUndefined();
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

  it("declares what the adapter supports, from what the real CLI was seen to do", () => {
    // Resume is verified. The headless stream has no command list (a slash command sent with -p reaches the model as
    // plain text) and reports tokens only, never plan usage, so those two stay false.
    expect(capabilitiesOf(runner)).toEqual({
      resume: true,
      chooseModel: true,
      commandList: false,
      visibleReasoning: true,
      planUsage: false,
    });
  });
});

describe("CursorAgentRunner resume and model", () => {
  const argvOf = async (request: Partial<AgentRunRequest>, from: CursorAgentRunner = runner): Promise<string[]> => {
    const events: AgentEvent[] = [];
    await from.run({ cwd: here, prompt: "do it MODE:ok", timeoutMs: 10_000, ...request }, (e) => events.push(e));
    return (events.find((e) => e.type === "system")!.raw as { argv: string[] }).argv;
  };

  it("does not resume unless asked", async () => {
    expect(await argvOf({})).not.toContain("--resume");
  });

  it("continues the given chat with --resume and keeps its id", async () => {
    const argv = await argvOf({ resumeSessionId: "chat-42" });
    expect(argv.slice(argv.indexOf("--resume"), argv.indexOf("--resume") + 2)).toEqual(["--resume", "chat-42"]);
    expect(argv.at(-1)).toContain("MODE:ok");
    const r = await runner.run({ cwd: here, prompt: "again MODE:ok", timeoutMs: 10_000, resumeSessionId: "chat-42" });
    expect(r.sessionId).toBe("chat-42");
    expect(r.isError).toBe(false);
  });

  it("still passes the headless flags when resuming", async () => {
    expect(await argvOf({ resumeSessionId: "chat-42" })).toEqual(expect.arrayContaining(["-p", "--force", "--output-format", "stream-json"]));
  });

  it("uses the request's model over the one the runner was built with, and the built-in one otherwise", async () => {
    const withDefault = new CursorAgentRunner({
      command: process.execPath,
      prefixArgs: [join(here, "__fixtures__/fake-agent.mjs")],
      model: "composer-2.5",
      killGraceMs: 200,
    });
    const valueOf = (argv: string[]) => argv[argv.indexOf("--model") + 1];
    expect(valueOf(await argvOf({}, withDefault))).toBe("composer-2.5");
    expect(valueOf(await argvOf({ profile: { model: "auto" } }, withDefault))).toBe("auto");
    expect(valueOf(await argvOf({ profile: { model: "" } }, withDefault))).toBe("composer-2.5");
    expect(await argvOf({ profile: {} })).not.toContain("--model");
  });
});

describe("a real Cursor stream (sanitized fixture)", () => {
  const events = readFileSync(join(here, "__fixtures__/stream-resume.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { type: string; subtype?: string; session_id?: string; result?: string });

  it("carries the chat id in the init and result events, and a resumed turn keeps the same id", () => {
    const inits = events.filter((e) => e.type === "system" && e.subtype === "init");
    const results = events.filter((e) => e.type === "result");
    expect(inits).toHaveLength(2);
    expect(results.map((r) => r.result)).toEqual(["ok", "PINEAPPLE"]);
    expect(new Set([...inits, ...results].map((e) => e.session_id))).toEqual(new Set(["chat-0001"]));
  });

  it("has no command list and no plan usage anywhere in the stream", () => {
    const text = JSON.stringify(events);
    expect(text).not.toContain("slash_commands");
    expect(text).not.toMatch(/rate_limit|planUsage|utilization/);
  });
});

describe("listModels", () => {
  const withFlags = (...flags: string[]) =>
    new CursorAgentRunner({ command: process.execPath, prefixArgs: [join(here, "__fixtures__/fake-agent.mjs"), ...flags], killGraceMs: 200 });

  it("returns the model ids `agent models` prints, without the title, labels, zero-width spaces or the tip", async () => {
    expect(await runner.listModels()).toEqual(["auto", "composer-2.5-fast", "grok-4.7-low-fast", "claude-sonnet-5-thinking-high"]);
  });

  it("returns an empty list when the command fails or prints something unexpected", async () => {
    expect(await withFlags("--fake-fail").listModels()).toEqual([]);
    expect(await withFlags("--fake-junk").listModels()).toEqual([]);
    expect(await new CursorAgentRunner({ command: "definitely-not-a-real-binary-xyz" }).listModels()).toEqual([]);
  });
});

describe("capabilitiesOf", () => {
  it("returns all-false for a runner that declares none", () => {
    const bare: AgentRunner = { run: async () => ({ exitCode: 0, isError: false, resultText: "", durationMs: 0, timedOut: false }) };
    expect(capabilitiesOf(bare)).toEqual({
      resume: false,
      chooseModel: false,
      commandList: false,
      visibleReasoning: false,
      planUsage: false,
    });
  });

  it("fills in the flags a partial declaration leaves out", () => {
    const partial = { run: bareRun, capabilities: { resume: true } } as unknown as AgentRunner;
    expect(capabilitiesOf(partial)).toMatchObject({ resume: true, chooseModel: false });
  });
});

async function bareRun() {
  return { exitCode: 0, isError: false, resultText: "", durationMs: 0, timedOut: false };
}

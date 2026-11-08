import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ClaudeAgentRunner, type ClaudeRunnerOptions } from "./claude-runner.js";
import { capabilitiesOf, type AgentEvent } from "../../../core/ports/agent-runner.js";

const here = dirname(fileURLToPath(import.meta.url));
const fake = join(here, "__fixtures__/fake-claude.mjs");

const make = (options: ClaudeRunnerOptions = {}) =>
  new ClaudeAgentRunner({ command: process.execPath, prefixArgs: [fake], killGraceMs: 200, ...options });

const run = (mode: string, options: ClaudeRunnerOptions = {}, timeoutMs = 10_000, onEvent?: (e: AgentEvent) => void) =>
  make(options).run({ cwd: here, prompt: `do it MODE:${mode}`, timeoutMs }, onEvent);

/** The argv the fake binary saw (carried by the init event). */
async function argvOf(options: ClaudeRunnerOptions = {}, request: Partial<Parameters<ClaudeAgentRunner["run"]>[0]> = {}) {
  const events: AgentEvent[] = [];
  await make(options).run({ cwd: here, prompt: "do it MODE:ok", timeoutMs: 10_000, ...request }, (e) => events.push(e));
  const init = events.find((e) => e.type === "system" && (e.raw as { subtype?: string }).subtype === "init")!;
  return (init.raw as { argv: string[] }).argv;
}

describe("ClaudeAgentRunner", () => {
  it("names itself and declares what the adapter supports", () => {
    const runner = make();
    expect(runner.name).toBe("claude");
    expect(capabilitiesOf(runner)).toEqual({
      resume: true,
      chooseModel: true,
      commandList: true,
      visibleReasoning: false,
      planUsage: true,
    });
  });

  it("maps a successful stream to an AgentRunResult", async () => {
    const r = await run("ok");
    expect(r).toMatchObject({
      exitCode: 0,
      isError: false,
      resultText: "ok",
      outputTokens: 81,
      sessionId: "sess-claude-1",
      timedOut: false,
    });
    expect(r.durationMs).toBeGreaterThan(0);
  });

  it("counts input tokens as new plus cache-creation plus cache-read tokens", async () => {
    const r = await run("ok");
    expect(r.inputTokens).toBe(4 + 42300 + 91444);
  });

  it("builds meta from the stream: commands without the terminal-only ones, plan usage and model", async () => {
    const r = await run("ok");
    expect(r.meta).toEqual({
      commands: ["compact", "context", "usage", "clear", "model", "my-skill"],
      planUsage: [
        { name: "five_hour", utilization: 0.37, resetsAt: 1780000000 },
        { name: "seven_day", utilization: 0.18, resetsAt: 1780400000 },
      ],
      model: "claude-haiku-5-5",
    });
  });

  it("runs `claude -p` with stream-json, the prompt last after `--`, and in the given cwd", async () => {
    const events: AgentEvent[] = [];
    await run("ok", {}, 10_000, (e) => events.push(e));
    const init = events.find((e) => (e.raw as { subtype?: string }).subtype === "init")!.raw as { argv: string[]; cwd: string };
    const argv = init.argv;
    expect(argv.slice(0, 4)).toEqual(["-p", "--output-format", "stream-json", "--verbose"]);
    expect(argv.at(-2)).toBe("--");
    expect(argv.at(-1)).toContain("MODE:ok");
    expect(init.cwd).toBe(here);
  });

  it("uses the user's own configuration by default: no --bare and no --strict-mcp-config", async () => {
    const argv = await argvOf();
    expect(argv).not.toContain("--bare");
    expect(argv).not.toContain("--strict-mcp-config");
    expect(argv).not.toContain("--model");
    expect(argv).not.toContain("--resume");
  });

  it("passes strictMcp, model, effort and permission mode when configured", async () => {
    const argv = await argvOf({ strictMcp: true, model: "claude-haiku-5-5", effort: "low", permissionMode: "plan" });
    expect(argv).toEqual(
      expect.arrayContaining(["--strict-mcp-config", "--model", "claude-haiku-5-5", "--effort", "low", "--permission-mode", "plan"]),
    );
    expect(argv[argv.indexOf("--model") + 1]).toBe("claude-haiku-5-5");
    expect(argv[argv.indexOf("--effort") + 1]).toBe("low");
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("plan");
  });

  it("resumes a session with --resume, from the option or the request", async () => {
    const fromOption = await argvOf({ resumeSessionId: "abc" });
    expect(fromOption[fromOption.indexOf("--resume") + 1]).toBe("abc");
    const fromRequest = await argvOf({ resumeSessionId: "abc" }, { resumeSessionId: "xyz" });
    expect(fromRequest[fromRequest.indexOf("--resume") + 1]).toBe("xyz");
    expect(fromRequest.filter((a) => a === "--resume")).toHaveLength(1);
  });

  it("lets the per-turn profile override the defaults field by field", async () => {
    const argv = await argvOf(
      { model: "default-model", effort: "high" },
      { profile: { model: "turn-model", permissionMode: "acceptEdits" } },
    );
    expect(argv[argv.indexOf("--model") + 1]).toBe("turn-model");
    expect(argv[argv.indexOf("--effort") + 1]).toBe("high");
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
  });

  it("passes a prompt that starts with a dash as the prompt, not as a flag", async () => {
    const argv = await argvOf({}, { prompt: "- fix it MODE:ok" });
    expect(argv.slice(-2)).toEqual(["--", "- fix it MODE:ok"]);
  });

  it("reuses the session id on a resumed turn", async () => {
    const r = await run("resume", { resumeSessionId: "sess-claude-1" });
    expect(r).toMatchObject({ isError: false, resultText: "echo hi", sessionId: "sess-claude-1" });
  });

  it("returns a slash command's local answer as the result, with no tokens spent", async () => {
    const r = await run("usage");
    expect(r.isError).toBe(false);
    expect(r.resultText).toContain("Current session:");
    expect(r.inputTokens).toBe(0);
    expect(r.outputTokens).toBe(0);
    expect(r.meta?.planUsage).toBeUndefined();
  });

  it("forwards every parsed event in order and ignores non-JSON lines", async () => {
    const events: AgentEvent[] = [];
    await run("ok", {}, 10_000, (e) => events.push(e));
    expect(events.map((e) => e.type)).toEqual([
      "system", "system", "system", "rate_limit_event", "assistant", "user", "assistant", "result",
    ]);
    const g: AgentEvent[] = [];
    const r = await run("garbage", {}, 10_000, (e) => g.push(e));
    expect(g.map((e) => e.type)).toEqual(["result"]);
    expect(r).toMatchObject({ isError: false, resultText: "still fine" });
  });

  it("reports an error result with a non-zero exit code", async () => {
    const r = await run("error");
    expect(r).toMatchObject({ exitCode: 1, isError: true, resultText: "model exploded" });
  });

  it("uses the errors list as text when a failure result has no text", async () => {
    const r = await run("errors");
    expect(r).toMatchObject({ isError: true, resultText: "max turns reached" });
  });

  it("reports a crash without a result using stderr as the text", async () => {
    const r = await run("crash");
    expect(r.exitCode).toBe(3);
    expect(r.isError).toBe(true);
    expect(r.resultText).toContain("fatal: something broke");
  });

  it("treats a clean exit without a result event as an error, keeping the init session id", async () => {
    const r = await run("noresult");
    expect(r).toMatchObject({ exitCode: 0, isError: true, sessionId: "sess-claude-1" });
    expect(r.resultText).toContain("no result");
  });

  it("kills a hanging agent on timeout", async () => {
    const started = Date.now();
    const r = await run("hang", {}, 400);
    expect(r.timedOut).toBe(true);
    expect(r.isError).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("reports a missing binary instead of throwing", async () => {
    const missing = new ClaudeAgentRunner({ command: "definitely-not-a-real-binary-xyz" });
    const r = await missing.run({ cwd: here, prompt: "x", timeoutMs: 5000 });
    expect(r.isError).toBe(true);
    expect(r.exitCode).toBeNull();
    expect(r.resultText).toContain("definitely-not-a-real-binary-xyz");
  });
});

describe("ClaudeAgentRunner listModels", () => {
  it("offers the aliases `claude --help` documents, plus full ids seen in real streams, without calling the CLI", async () => {
    // The binary does not exist: a real call would fail, so this also proves the list is static.
    const models = await new ClaudeAgentRunner({ command: "definitely-not-a-real-binary-xyz" }).listModels();
    expect(models).toEqual(expect.arrayContaining(["sonnet", "opus", "haiku"]));
    expect(models).toContain("claude-sonnet-5-5");
    expect(new Set(models).size).toBe(models.length);
  });
});

// Fake `agent` CLI for tests. Behavior is chosen by a MODE:<x> marker in the prompt (last argv).
const argv = process.argv.slice(2);
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");

// `agent models`: the real output has a title, one `<id> - <label>` line per model (some labels end in
// zero-width spaces), a blank line and a tip. `--fake-fail` and `--fake-junk` choose the broken variants.
if (argv.includes("models")) {
  if (argv.includes("--fake-fail")) {
    process.stderr.write("Not logged in\n");
    process.exit(1);
  }
  if (argv.includes("--fake-junk")) {
    process.stdout.write("this is not a model list\n");
    process.exit(0);
  }
  process.stdout.write(
    [
      "Available models",
      "",
      "auto - Auto (current, default)",
      "composer-2.5-fast - Composer 2.5 Fast",
      "grok-4.7-low-fast - Grok 4.7  Low Fast​​",
      "claude-sonnet-5-thinking-high - Claude Sonnet 5 1M Thinking",
      "",
      "Tip: use --model <id> (or /model <id> in interactive mode) to switch. Parameterized models also accept quoted overrides,",
      "e.g. --model 'claude-opus-4-8[context=1m,effort=high,fast=false]'.",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

const prompt = argv[argv.length - 1] ?? "";
const mode = /MODE:(\w+)/.exec(prompt)?.[1] ?? "ok";
// A resumed chat keeps its id, as the real CLI does.
const resumeAt = argv.indexOf("--resume");
const sessionId = resumeAt >= 0 ? argv[resumeAt + 1] : "sess-1";

emit({ type: "system", subtype: "init", session_id: sessionId, argv, cwd: process.cwd() });

if (mode === "ok") {
  emit({ type: "tool_call", subtype: "started", call_id: "c1" });
  emit({ type: "tool_call", subtype: "completed", call_id: "c1" });
  emit({
    type: "result", subtype: "success", is_error: false, duration_ms: 5, result: "done",
    session_id: sessionId, usage: { inputTokens: 100, outputTokens: 20 },
  });
} else if (mode === "error") {
  emit({ type: "result", subtype: "error", is_error: true, result: "model exploded", session_id: sessionId });
  process.exit(1);
} else if (mode === "garbage") {
  process.stdout.write("not json at all\n{broken\n");
  emit({ type: "result", subtype: "success", is_error: false, result: "still fine" });
} else if (mode === "crash") {
  process.stderr.write("fatal: something broke\n");
  process.exit(3);
} else if (mode === "noresult") {
  // exits 0 without ever emitting a result event
} else if (mode === "hang") {
  setInterval(() => {}, 1000);
}

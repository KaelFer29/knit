// Fake `agent` CLI for tests. Behavior is chosen by a MODE:<x> marker in the prompt (last argv).
const argv = process.argv.slice(2);
const prompt = argv[argv.length - 1] ?? "";
const mode = /MODE:(\w+)/.exec(prompt)?.[1] ?? "ok";
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");

emit({ type: "system", subtype: "init", session_id: "sess-1", argv, cwd: process.cwd() });

if (mode === "ok") {
  emit({ type: "tool_call", subtype: "started", call_id: "c1" });
  emit({ type: "tool_call", subtype: "completed", call_id: "c1" });
  emit({
    type: "result", subtype: "success", is_error: false, duration_ms: 5, result: "done",
    session_id: "sess-1", usage: { inputTokens: 100, outputTokens: 20 },
  });
} else if (mode === "error") {
  emit({ type: "result", subtype: "error", is_error: true, result: "model exploded", session_id: "sess-1" });
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

// Fake `claude` CLI for tests. Behavior is chosen by a MODE:<x> marker in the prompt (last argv).
// The ok, usage and resume modes replay streams recorded from the real CLI (sanitized, see the
// stream-*.jsonl files next to this script). The init event additionally carries `argv` and `cwd`
// so tests can see how the binary was called; the real CLI does not emit them.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const prompt = argv[argv.length - 1] ?? "";
const mode = /MODE:(\w+)/.exec(prompt)?.[1] ?? "ok";
const here = dirname(fileURLToPath(import.meta.url));
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");

const replay = (file) => {
  const lines = readFileSync(join(here, file), "utf8").trim().split("\n");
  for (const line of lines) {
    const event = JSON.parse(line);
    emit(event.type === "system" && event.subtype === "init" ? { ...event, argv, cwd: process.cwd() } : event);
  }
};

// `/usage` asked in print mode with JSON output: a local command, answered at once with no model call.
if (prompt === "/usage" && argv.includes("--no-session-persistence") && argv.includes("json")) {
  const result = [
    "You are currently using your subscription to power your Claude Code usage",
    "",
    "Current session: 36% used · resets Nov 9, 3:10am (America/Santiago)",
    "Current week (all models): 50% used · resets Nov 12, 1am (America/Santiago)",
    "",
    "Last 24h · 1765 requests · 9 sessions",
    "  89%  Give \"general-purpose\" subagents a cheaper model",
  ].join("\n");
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, local_command: "usage", total_cost_usd: 0, result }));
  process.exit(0);
}

const init = { type: "system", subtype: "init", session_id: "sess-claude-1", model: "claude-haiku-5-5", argv, cwd: process.cwd() };

if (mode === "ok") replay("stream-tools.jsonl");
else if (mode === "usage") replay("stream-usage.jsonl");
else if (mode === "resume") replay("stream-resume.jsonl");
else if (mode === "error") {
  emit(init);
  emit({ type: "result", subtype: "error_during_execution", is_error: true, result: "model exploded", session_id: "sess-claude-1" });
  process.exit(1);
} else if (mode === "errors") {
  // Failure results can carry an `errors` list and no `result` text.
  emit(init);
  emit({ type: "result", subtype: "error_max_turns", is_error: true, errors: ["max turns reached"], session_id: "sess-claude-1" });
  process.exit(1);
} else if (mode === "garbage") {
  process.stdout.write("not json at all\n{broken\n");
  emit({ type: "result", subtype: "success", is_error: false, result: "still fine", session_id: "sess-claude-1" });
} else if (mode === "crash") {
  process.stderr.write("fatal: something broke\n");
  process.exit(3);
} else if (mode === "noresult") {
  emit(init);
} else if (mode === "hang") {
  emit(init);
  setInterval(() => {}, 1000);
}

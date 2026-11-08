// Fake `gh` CLI for tests. FAKE_GH_AUTH=0|1, FAKE_GH_MODE=ok|exists|fail, FAKE_GH_LOG=<file>.
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
if (process.env.FAKE_GH_LOG) appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + "\n");
const mode = process.env.FAKE_GH_MODE ?? "ok";

if (args[0] === "auth") {
  process.exit(process.env.FAKE_GH_AUTH === "0" ? 1 : 0);
}
if (args[0] === "pr" && args[1] === "create") {
  if (mode === "exists") {
    process.stderr.write("a pull request for branch already exists\n");
    process.exit(1);
  }
  if (mode === "fail") {
    process.stderr.write("GraphQL: not allowed\n");
    process.exit(1);
  }
  process.stdout.write("Creating pull request...\nhttps://github.com/acme/demo/pull/7\n");
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "view") {
  process.stdout.write("https://github.com/acme/demo/pull/3\n");
  process.exit(0);
}
process.exit(2);

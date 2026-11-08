import { describe, expect, it } from "vitest";
import { killActiveProcessGroups, spawnWithTimeout } from "./spawn-with-timeout.js";

describe("killActiveProcessGroups", () => {
  it("kills running children so an abort does not leave orphans", async () => {
    const pending = spawnWithTimeout("bash", ["-c", "sleep 30 & wait"], { cwd: process.cwd(), timeoutMs: 60_000 });
    await new Promise((r) => setTimeout(r, 200));
    const started = Date.now();
    killActiveProcessGroups();
    const res = await pending;
    expect(Date.now() - started).toBeLessThan(3000);
    expect(res.exitCode === 0).toBe(false);
  });
});

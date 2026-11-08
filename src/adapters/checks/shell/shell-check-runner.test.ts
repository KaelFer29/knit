import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ShellCheckRunner } from "./shell-check-runner.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "orq-shell-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const runner = new ShellCheckRunner({ killGraceMs: 200 });

describe("ShellCheckRunner", () => {
  it("returns exit code 0 and output for a passing command", async () => {
    const r = await runner.run("echo hello", dir, 5000);
    expect(r).toMatchObject({ command: "echo hello", exitCode: 0, timedOut: false });
    expect(r.output).toContain("hello");
  });

  it("returns a non-zero exit code and merges stderr into the output", async () => {
    const r = await runner.run("echo out; echo err 1>&2; exit 4", dir, 5000);
    expect(r.exitCode).toBe(4);
    expect(r.output).toContain("out");
    expect(r.output).toContain("err");
  });

  it("runs in the given cwd", async () => {
    writeFileSync(join(dir, "marker.txt"), "x");
    const r = await runner.run("ls", dir, 5000);
    expect(r.output).toContain("marker.txt");
  });

  it("kills the whole process group on timeout", async () => {
    const started = Date.now();
    const r = await runner.run("sleep 30 & wait", dir, 400);
    expect(r.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("keeps only the tail of very large output", async () => {
    const small = new ShellCheckRunner({ maxOutputBytes: 1000 });
    const r = await small.run("seq 1 5000", dir, 5000);
    expect(r.output.length).toBeLessThanOrEqual(1000);
    expect(r.output).toContain("5000");
    expect(r.output).not.toContain("\n1\n");
  });
});

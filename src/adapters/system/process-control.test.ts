import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { SystemProcessControl } from "./process-control.js";

const control = new SystemProcessControl();
const children: ChildProcess[] = [];

/** A node process that idles; `marker` ends up in its command line. */
function idle(marker: string, options: { detached?: boolean; ignoreSigterm?: boolean } = {}): ChildProcess {
  const code = `${options.ignoreSigterm ? "process.on('SIGTERM',()=>{});" : ""}setInterval(()=>{},1000)`;
  const child = spawn(process.execPath, ["-e", code, marker], { detached: options.detached ?? false, stdio: "ignore" });
  children.push(child);
  return child;
}

/** A detached shell that starts a grandchild in its own group, prints the grandchild pid and idles. */
async function treeWithGrandchild(): Promise<{ root: ChildProcess; grandchildPid: number }> {
  const script = `
    const { spawn } = require("node:child_process");
    const g = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", "grandchild"], { detached: true, stdio: "ignore" });
    process.stdout.write(String(g.pid) + "\\n");
    setInterval(() => {}, 1000);
  `;
  const root = spawn(process.execPath, ["-e", script], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  children.push(root);
  const grandchildPid = await new Promise<number>((resolve) => root.stdout!.once("data", (d: Buffer) => resolve(Number(d.toString().trim()))));
  return { root, grandchildPid };
}

const exited = (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve() : child.once("exit", () => resolve())));

async function until(check: () => boolean, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return check();
}

afterEach(() => {
  for (const c of children.splice(0)) {
    try {
      if (c.pid) process.kill(-c.pid, "SIGKILL");
    } catch {
      /* not a group leader or already gone */
    }
    c.kill("SIGKILL");
  }
});

describe("SystemProcessControl", () => {
  it("sees a running process as alive and an exited one as gone", async () => {
    const child = idle("alive-probe");
    expect(control.isAlive(child.pid!)).toBe(true);
    child.kill("SIGKILL");
    await exited(child);
    expect(control.isAlive(child.pid!)).toBe(false);
  });

  it("does not treat a zombie as alive", async () => {
    // The parent (this test) does not reap until the event loop turns; poll the zombie window then the reaped state.
    const child = idle("zombie-probe");
    child.kill("SIGKILL");
    expect(await until(() => !control.isAlive(child.pid!))).toBe(true);
  });

  it("never inspects or signals pids 0, 1, negative or fractional", () => {
    for (const pid of [0, 1, -5, 2.5, Number.NaN]) {
      expect(control.isAlive(pid)).toBe(false);
      expect(control.commandLine(pid)).toBeUndefined();
      expect(control.signal(pid, "SIGTERM")).toBe(false);
      expect(control.signalGroup(pid, "SIGTERM")).toBe(false);
    }
  });

  it("reads the command line and matches it against a marker", () => {
    const child = idle("marker-abc-123");
    expect(control.commandLine(child.pid!)).toEqual([process.execPath, "-e", expect.any(String), "marker-abc-123"]);
    expect(control.commandMatches(child.pid!, /marker-abc-123/)).toBe(true);
  });

  it("rejects a process whose command line has another marker", () => {
    const child = idle("some-other-process");
    expect(control.commandMatches(child.pid!, /marker-abc-123/)).toBe(false);
  });

  it("reports nothing for a process that is gone", async () => {
    const child = idle("gone");
    child.kill("SIGKILL");
    await exited(child);
    expect(control.commandLine(child.pid!)).toBeUndefined();
    expect(control.commandMatches(child.pid!, /gone/)).toBe(false);
    expect(control.processGroupOf(child.pid!)).toBeUndefined();
    expect(control.signal(child.pid!, "SIGTERM")).toBe(false);
  });

  it("signals one process", async () => {
    const child = idle("signal-one");
    expect(control.signal(child.pid!, "SIGTERM")).toBe(true);
    await exited(child);
    expect(child.signalCode).toBe("SIGTERM");
  });

  it("reports the group of a detached child as its own pid and the group of a plain child as ours", () => {
    const leader = idle("leader", { detached: true });
    const member = idle("member");
    expect(control.processGroupOf(leader.pid!)).toBe(leader.pid);
    expect(control.processGroupOf(member.pid!)).toBe(control.processGroupOf(process.pid));
  });

  it("finds a descendant in its own group, which a kill of the parent's group does not reach", async () => {
    const { root, grandchildPid } = await treeWithGrandchild();
    expect(control.descendantGroups(root.pid!)).toEqual([grandchildPid]);

    expect(control.signalGroup(root.pid!, "SIGKILL")).toBe(true);
    await exited(root);
    // The grandchild runs in another group, so the root's group kill did not reach it.
    expect(control.isAlive(grandchildPid)).toBe(true);
    expect(control.signalGroup(grandchildPid, "SIGKILL")).toBe(true);
    expect(await until(() => !control.isAlive(grandchildPid))).toBe(true);
  });

  it("kills every member of one group with a single call", async () => {
    // Two members of the same detached group: the leader starts a non-detached child.
    const script = `
      const { spawn } = require("node:child_process");
      const c = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
      process.stdout.write(String(c.pid) + "\\n");
      setInterval(() => {}, 1000);
    `;
    const root = spawn(process.execPath, ["-e", script], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
    children.push(root);
    const memberPid = await new Promise<number>((resolve) => root.stdout!.once("data", (d: Buffer) => resolve(Number(d.toString().trim()))));
    expect(control.processGroupOf(memberPid)).toBe(root.pid);

    expect(control.signalGroup(root.pid!, "SIGKILL")).toBe(true);
    await exited(root);
    expect(await until(() => !control.isAlive(memberPid))).toBe(true);
  });

  it("lists no descendant groups for a process without children", () => {
    const child = idle("childless", { detached: true });
    expect(control.descendantGroups(child.pid!)).toEqual([]);
  });

  it("refuses to signal the caller's own process group", () => {
    const own = control.processGroupOf(process.pid)!;
    expect(control.signalGroup(own, "SIGTERM")).toBe(false);
  });

  it("refuses to signal itself", () => {
    expect(control.signal(process.pid, "SIGTERM")).toBe(false);
  });
});

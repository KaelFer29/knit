import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { ProcessControl } from "../../core/ports/process-control.js";

interface ProcessInfo {
  pid: number;
  ppid: number;
  pgid: number;
  /** Single-letter state; `Z` is a zombie. */
  state: string;
}

const PROC = "/proc";

/** `/proc/<pid>/stat` is `pid (comm) state ppid pgrp ...`; comm may contain spaces and parentheses, so cut at the last `)`. */
function parseStat(text: string): ProcessInfo | undefined {
  const close = text.lastIndexOf(")");
  if (close < 0) return undefined;
  const pid = Number.parseInt(text, 10);
  const rest = text.slice(close + 2).split(" ");
  const ppid = Number(rest[1]);
  const pgid = Number(rest[2]);
  if (!Number.isInteger(pid) || !Number.isInteger(ppid) || !Number.isInteger(pgid)) return undefined;
  return { pid, ppid, pgid, state: rest[0] ?? "" };
}

function procInfo(pid: number): ProcessInfo | undefined {
  try {
    return parseStat(readFileSync(`${PROC}/${pid}/stat`, "utf8"));
  } catch {
    return undefined;
  }
}

function psOutput(args: string[]): string | undefined {
  try {
    return execFileSync("ps", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
}

function parsePsLine(line: string): ProcessInfo | undefined {
  const [pid, ppid, pgid, state] = line.trim().split(/\s+/);
  if (!pid || !ppid || !pgid) return undefined;
  return { pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), state: state?.[0] ?? "" };
}

/** Every process, from `/proc` where it exists and from `ps` elsewhere. */
function allProcesses(): ProcessInfo[] {
  if (existsSync(PROC)) {
    const found: ProcessInfo[] = [];
    for (const name of readdirSync(PROC)) {
      if (!/^\d+$/.test(name)) continue;
      const info = procInfo(Number(name));
      if (info) found.push(info);
    }
    return found;
  }
  const out = psOutput(["-A", "-o", "pid=,ppid=,pgid=,stat="]);
  return (out ?? "").split("\n").flatMap((line) => parsePsLine(line) ?? []);
}

function infoOf(pid: number): ProcessInfo | undefined {
  if (existsSync(PROC)) return procInfo(pid);
  return parsePsLine(psOutput(["-o", "pid=,ppid=,pgid=,stat=", "-p", String(pid)]) ?? "");
}

/** Pids 0 and 1 and anything that is not a positive integer are never inspected or signalled. */
const validPid = (pid: number): boolean => Number.isInteger(pid) && pid > 1;

/**
 * Linux implementation: `process.kill(pid, 0)` for existence and `/proc/<pid>` for the command line, group and parent.
 * Where `/proc` is missing (macOS) it falls back to `ps`, which reports the command line as one string, so arguments
 * containing spaces cannot be told apart there.
 */
export class SystemProcessControl implements ProcessControl {
  isAlive(pid: number): boolean {
    if (!validPid(pid)) return false;
    try {
      process.kill(pid, 0);
    } catch (err) {
      // EPERM means it exists but belongs to someone else.
      if ((err as NodeJS.ErrnoException).code !== "EPERM") return false;
    }
    return infoOf(pid)?.state !== "Z";
  }

  commandLine(pid: number): string[] | undefined {
    if (!validPid(pid)) return undefined;
    if (existsSync(PROC)) {
      try {
        const args = readFileSync(`${PROC}/${pid}/cmdline`, "utf8").split("\0");
        if (args.at(-1) === "") args.pop();
        return args.length > 0 ? args : undefined;
      } catch {
        return undefined;
      }
    }
    const out = psOutput(["-o", "args=", "-p", String(pid)])?.trim();
    return out ? out.split(/\s+/) : undefined;
  }

  commandMatches(pid: number, marker: RegExp): boolean {
    const args = this.commandLine(pid);
    return args !== undefined && this.isAlive(pid) && marker.test(args.join(" "));
  }

  processGroupOf(pid: number): number | undefined {
    if (!validPid(pid)) return undefined;
    return infoOf(pid)?.pgid;
  }

  descendantGroups(pid: number): number[] {
    if (!validPid(pid)) return [];
    const all = allProcesses();
    const children = new Map<number, ProcessInfo[]>();
    for (const p of all) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p]);
    const own = all.find((p) => p.pid === pid)?.pgid;
    const groups = new Set<number>();
    const seen = new Set<number>([pid]);
    const queue = [pid];
    while (queue.length > 0) {
      for (const child of children.get(queue.shift()!) ?? []) {
        if (seen.has(child.pid)) continue;
        seen.add(child.pid);
        queue.push(child.pid);
        if (child.state !== "Z" && child.pgid !== own && child.pgid > 1) groups.add(child.pgid);
      }
    }
    return [...groups];
  }

  signal(pid: number, signal: NodeJS.Signals): boolean {
    if (!validPid(pid) || pid === process.pid) return false;
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }

  signalGroup(pgid: number, signal: NodeJS.Signals): boolean {
    if (!validPid(pgid) || pgid === infoOf(process.pid)?.pgid) return false;
    try {
      process.kill(-pgid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

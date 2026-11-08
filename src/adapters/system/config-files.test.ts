import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigFileError } from "../../core/ports/config-files.js";
import { FileConfigFiles, MAX_CONFIG_BYTES } from "./config-files.js";

let base: string;
let project: string;
let home: string;
let outside: string;
let backups: string;
let files: FileConfigFiles;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "knit-config-"));
  project = join(base, "project");
  home = join(base, "home");
  outside = join(base, "outside");
  backups = join(base, "backups");
  for (const d of [project, home, outside]) mkdirSync(d);
  files = new FileConfigFiles({ projectDir: project, homeDir: home, backupDir: backups, now: () => new Date("2026-11-08T10:00:00.000Z") });
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

const put = (path: string, text: string): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ConfigFileError) return err.code;
    throw err;
  }
  return "no error";
}

describe("list", () => {
  it("offers the allow-list for both scopes with existence flags, and the rules files that exist", () => {
    put(join(project, "CLAUDE.md"), "# p");
    put(join(project, ".claude/rules/style.md"), "x");
    put(join(project, ".claude/rules/notes.txt"), "ignored extension");
    put(join(project, ".claude/rules/.hidden.md"), "ignored hidden");
    put(join(project, ".claude/rules/sub/deep.md"), "nested");
    put(join(project, ".cursor/rules/ui.mdc"), "x");
    put(join(home, ".claude/settings.json"), "{}");
    const list = files.list();
    const byId = Object.fromEntries(list.map((e) => [e.id, e]));
    expect(byId["claude:project:claude-md"]).toMatchObject({ exists: true, displayPath: "CLAUDE.md", scope: "project", agent: "claude" });
    expect(byId["claude:global:settings"]).toMatchObject({ exists: true, displayPath: "~/.claude/settings.json" });
    expect(byId["cursor:global:cli-config"]).toMatchObject({ exists: false, displayPath: "~/.cursor/cli-config.json" });
    expect(byId["claude:project:rules/style.md"]).toMatchObject({ isRule: true, exists: true });
    expect(byId["claude:project:rules/sub/deep.md"]).toBeDefined();
    expect(byId["cursor:project:rules/ui.mdc"]).toBeDefined();
    expect(list.map((e) => e.label)).not.toContain("notes.txt");
    expect(list.map((e) => e.label)).not.toContain(".hidden.md");
  });

  it("does not list rules reached through a symlink that leaves the root", () => {
    put(join(outside, "evil.md"), "x");
    mkdirSync(join(project, ".claude"));
    symlinkSync(outside, join(project, ".claude/rules"));
    expect(files.list().filter((e) => e.isRule)).toEqual([]);
  });
});

describe("read", () => {
  it("returns content and hash, and an absent file as empty with hash 'absent'", () => {
    put(join(project, "CLAUDE.md"), "hello");
    const read = files.read("claude:project:claude-md");
    expect(read).toMatchObject({ exists: true, content: "hello", json: false });
    expect(read.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(files.read("cursor:project:mcp")).toEqual({ id: "cursor:project:mcp", exists: false, content: "", hash: "absent", json: true });
  });

  it.each([
    "claude:project:../../etc/passwd",
    "claude:project:rules/../../CLAUDE.md",
    "claude:project:rules/..%2Fx.md",
    "claude:project:rules//x.md",
    "claude:project:rules/",
    "claude:project:rules/x.txt",
    "claude:project:rules/.md",
    "claude:project:rules/a/b/c/d.md",
    "claude:project:rules/a\\b.md",
    "claude:project:rules/x\0.md",
    "claude:project:/etc/passwd",
    "claude:project:unknown",
    "claude:project",
    "cursor:project:cli-config",
    "cursor:global:rules/x.mdc",
    "other:project:settings",
    "",
  ])("rejects the id %j as forbidden", (id) => {
    expect(codeOf(() => files.read(id))).toBe("forbidden");
    expect(codeOf(() => files.write(id, "x", "absent"))).toBe("forbidden");
  });

  it("rejects ids that are not strings", () => {
    expect(codeOf(() => files.read(undefined as unknown as string))).toBe("forbidden");
    expect(codeOf(() => files.write({} as unknown as string, "x", "absent"))).toBe("forbidden");
  });

  it("refuses a file that is a symlink to somewhere outside the root", () => {
    put(join(outside, "secret.md"), "secret");
    symlinkSync(join(outside, "secret.md"), join(project, "CLAUDE.md"));
    expect(codeOf(() => files.read("claude:project:claude-md"))).toBe("forbidden");
  });

  it("refuses a config folder that is a symlink to somewhere outside the root", () => {
    put(join(outside, "settings.json"), "{}");
    symlinkSync(outside, join(home, ".claude"));
    expect(codeOf(() => files.read("claude:global:settings"))).toBe("forbidden");
  });

  it("refuses a broken symlink", () => {
    symlinkSync(join(outside, "missing.md"), join(project, "CLAUDE.md"));
    expect(codeOf(() => files.read("claude:project:claude-md"))).toBe("forbidden");
  });

  it("follows a symlink that stays inside the root", () => {
    put(join(project, "docs/real.md"), "real");
    symlinkSync(join(project, "docs/real.md"), join(project, "CLAUDE.md"));
    expect(files.read("claude:project:claude-md").content).toBe("real");
  });

  it("rejects a directory in place of a file, non-UTF-8 bytes and oversized files", () => {
    mkdirSync(join(project, "CLAUDE.md"));
    expect(codeOf(() => files.read("claude:project:claude-md"))).toBe("invalid");
    rmSync(join(project, "CLAUDE.md"), { recursive: true });
    writeFileSync(join(project, "CLAUDE.md"), Buffer.from([0xff, 0xfe, 0x41]));
    expect(codeOf(() => files.read("claude:project:claude-md"))).toBe("invalid");
    writeFileSync(join(project, "CLAUDE.md"), "a".repeat(MAX_CONFIG_BYTES + 1));
    expect(codeOf(() => files.read("claude:project:claude-md"))).toBe("too-large");
  });
});

describe("write", () => {
  it("backs up the previous version, replaces the file and returns the new hash", () => {
    put(join(project, ".claude/settings.json"), '{"a":1}');
    chmodSync(join(project, ".claude/settings.json"), 0o640);
    const before = files.read("claude:project:settings");
    const result = files.write("claude:project:settings", '{"a":2}', before.hash);
    expect(readFileSync(join(project, ".claude/settings.json"), "utf8")).toBe('{"a":2}');
    expect(statSync(join(project, ".claude/settings.json")).mode & 0o777).toBe(0o640);
    expect(result.backupPath).toBeDefined();
    expect(result.backupPath!.startsWith(backups)).toBe(true);
    expect(readFileSync(result.backupPath!, "utf8")).toBe('{"a":1}');
    expect(statSync(result.backupPath!).mode & 0o777).toBe(0o600);
    expect(files.read("claude:project:settings").hash).toBe(result.hash);
    expect(readdirSync(join(project, ".claude"))).toEqual(["settings.json"]);
  });

  it("keeps every backup when the file is saved twice", () => {
    put(join(project, "CLAUDE.md"), "v1");
    const r1 = files.write("claude:project:claude-md", "v2", files.read("claude:project:claude-md").hash);
    const r2 = files.write("claude:project:claude-md", "v3", r1.hash);
    expect(readFileSync(r1.backupPath!, "utf8")).toBe("v1");
    expect(readFileSync(r2.backupPath!, "utf8")).toBe("v2");
  });

  it("creates a missing file and its folders when the caller expects it to be absent, without a backup", () => {
    const result = files.write("cursor:project:rules/new/style.mdc", "---\n---\n", "absent");
    expect(result.backupPath).toBeUndefined();
    expect(readFileSync(join(project, ".cursor/rules/new/style.mdc"), "utf8")).toBe("---\n---\n");
    expect(existsSync(backups)).toBe(false);
  });

  it("creates new JSON files private to the user", () => {
    files.write("cursor:global:cli-config", "{}", "absent");
    expect(statSync(join(home, ".cursor/cli-config.json")).mode & 0o777).toBe(0o600);
  });

  it("fails with conflict, leaving file and backups untouched, when the file changed since it was read", () => {
    put(join(project, "CLAUDE.md"), "v1");
    const stale = files.read("claude:project:claude-md").hash;
    writeFileSync(join(project, "CLAUDE.md"), "changed elsewhere");
    expect(codeOf(() => files.write("claude:project:claude-md", "mine", stale))).toBe("conflict");
    expect(readFileSync(join(project, "CLAUDE.md"), "utf8")).toBe("changed elsewhere");
    expect(existsSync(backups)).toBe(false);
  });

  it("fails with conflict when the caller expects an absent file that now exists, or an existing one that is gone", () => {
    put(join(project, "CLAUDE.md"), "v1");
    expect(codeOf(() => files.write("claude:project:claude-md", "x", "absent"))).toBe("conflict");
    expect(codeOf(() => files.write("cursor:project:mcp", "{}", "0".repeat(64)))).toBe("conflict");
    expect(existsSync(join(project, ".cursor"))).toBe(false);
  });

  it.each([
    ["not JSON", "{oops"],
    ["empty", ""],
    ["a JSON array", "[]"],
    ["a JSON string", '"x"'],
    ["null", "null"],
  ])("refuses a JSON file whose new content is %s and leaves it untouched", (_name, content) => {
    put(join(home, ".claude/settings.json"), '{"ok":true}');
    const hash = files.read("claude:global:settings").hash;
    expect(codeOf(() => files.write("claude:global:settings", content, hash))).toBe("invalid");
    expect(readFileSync(join(home, ".claude/settings.json"), "utf8")).toBe('{"ok":true}');
    expect(existsSync(backups)).toBe(false);
  });

  it("refuses NUL characters, oversized content and non-string content", () => {
    expect(codeOf(() => files.write("claude:project:claude-md", "a\0b", "absent"))).toBe("invalid");
    expect(codeOf(() => files.write("claude:project:claude-md", "a".repeat(MAX_CONFIG_BYTES + 1), "absent"))).toBe("too-large");
    expect(codeOf(() => files.write("claude:project:claude-md", 5 as unknown as string, "absent"))).toBe("invalid");
    expect(existsSync(join(project, "CLAUDE.md"))).toBe(false);
  });

  it("never writes through a symlink that leaves the root", () => {
    put(join(outside, "victim.md"), "victim");
    symlinkSync(join(outside, "victim.md"), join(project, "CLAUDE.md"));
    expect(codeOf(() => files.write("claude:project:claude-md", "pwned", "absent"))).toBe("forbidden");
    expect(readFileSync(join(outside, "victim.md"), "utf8")).toBe("victim");
  });

  it("never creates files through a config folder that is a symlink out of the root", () => {
    symlinkSync(outside, join(home, ".claude"));
    expect(codeOf(() => files.write("claude:global:settings", "{}", "absent"))).toBe("forbidden");
    expect(readdirSync(outside)).toEqual([]);
  });

  it("writes through a symlink that stays inside the root, keeping the link", () => {
    put(join(project, "docs/real.md"), "real");
    symlinkSync(join(project, "docs/real.md"), join(project, "CLAUDE.md"));
    files.write("claude:project:claude-md", "edited", files.read("claude:project:claude-md").hash);
    expect(readFileSync(join(project, "docs/real.md"), "utf8")).toBe("edited");
    expect(statSync(join(project, "CLAUDE.md")).isFile()).toBe(true);
  });

  it("leaves the previous version in place when the backup cannot be made", () => {
    put(join(project, "CLAUDE.md"), "v1");
    writeFileSync(backups, "a file where the backup folder should be");
    expect(codeOf(() => files.write("claude:project:claude-md", "v2", files.read("claude:project:claude-md").hash))).toBe("io");
    expect(readFileSync(join(project, "CLAUDE.md"), "utf8")).toBe("v1");
  });
});

describe("FileConfigFiles when something else writes during a save", () => {
  it("reports a conflict and keeps the other writer's version when the file changes after the first hash check", () => {
    const path = join(project, "CLAUDE.md");
    put(path, "original");
    let touched = false;
    const racing = new FileConfigFiles({
      projectDir: project,
      homeDir: home,
      backupDir: backups,
      // The backup stamps the time between the first hash check and the replacement: another tool writes right then.
      now: () => {
        if (!touched) {
          touched = true;
          writeFileSync(path, "written by another tool");
        }
        return new Date("2026-11-08T10:00:00.000Z");
      },
    });
    const hash = racing.read("claude:project:claude-md").hash;
    expect(codeOf(() => racing.write("claude:project:claude-md", "mine", hash))).toBe("conflict");
    expect(readFileSync(path, "utf8")).toBe("written by another tool");
    expect(readdirSync(project).filter((n) => n.includes(".tmp"))).toEqual([]);
  });

  it("refuses to replace a file whose folder was swapped for a link that leaves the root after the first check", () => {
    put(join(project, ".claude", "settings.json"), "{}");
    let swapped = false;
    const racing = new FileConfigFiles({
      projectDir: project,
      homeDir: home,
      backupDir: backups,
      now: () => {
        if (!swapped) {
          swapped = true;
          rmSync(join(project, ".claude"), { recursive: true });
          symlinkSync(outside, join(project, ".claude"));
        }
        return new Date("2026-11-08T10:00:00.000Z");
      },
    });
    const hash = racing.read("claude:project:settings").hash;
    expect(["forbidden", "conflict"]).toContain(codeOf(() => racing.write("claude:project:settings", "{\"a\":1}", hash)));
    expect(readdirSync(outside)).toEqual([]);
  });
});

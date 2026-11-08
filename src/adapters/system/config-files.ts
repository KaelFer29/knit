import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import {
  ConfigFileError,
  type ConfigAgent,
  type ConfigFileContent,
  type ConfigFileEntry,
  type ConfigFiles,
  type ConfigScope,
  type ConfigWriteResult,
} from "../../core/ports/config-files.js";

/** Largest file the editor reads or writes. */
export const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_RULE_DEPTH = 3;
/** One path segment of a rules file: no dot at the start (so no `..` and no hidden files), no separators. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

interface FixedFile {
  agent: ConfigAgent;
  scope: ConfigScope;
  slot: string;
  /** Path under the scope's root, as segments. */
  parts: string[];
  json: boolean;
}

interface RulesFolder {
  agent: ConfigAgent;
  scope: ConfigScope;
  parts: string[];
  extensions: string[];
}

/** The allow-list. Nothing outside these files and folders can be read or written. */
const FIXED: FixedFile[] = [
  { agent: "claude", scope: "project", slot: "claude-md", parts: ["CLAUDE.md"], json: false },
  { agent: "claude", scope: "project", slot: "settings", parts: [".claude", "settings.json"], json: true },
  { agent: "claude", scope: "global", slot: "claude-md", parts: [".claude", "CLAUDE.md"], json: false },
  { agent: "claude", scope: "global", slot: "settings", parts: [".claude", "settings.json"], json: true },
  { agent: "cursor", scope: "project", slot: "mcp", parts: [".cursor", "mcp.json"], json: true },
  { agent: "cursor", scope: "global", slot: "mcp", parts: [".cursor", "mcp.json"], json: true },
  { agent: "cursor", scope: "global", slot: "cli-config", parts: [".cursor", "cli-config.json"], json: true },
];

const RULES: RulesFolder[] = [
  { agent: "claude", scope: "project", parts: [".claude", "rules"], extensions: [".md"] },
  { agent: "claude", scope: "global", parts: [".claude", "rules"], extensions: [".md"] },
  { agent: "cursor", scope: "project", parts: [".cursor", "rules"], extensions: [".mdc", ".md"] },
];

export interface FileConfigFilesOptions {
  /** Root of the project scope (the directory `knit ui` was started in). */
  projectDir: string;
  /** Root of the global scope (the user's home directory). */
  homeDir: string;
  /** Where the replaced versions are copied. Outside both roots; created on first use. */
  backupDir: string;
  now?: () => Date;
}

interface Resolved {
  /** Where the file is (or would be): real path of the part that exists plus the parts that do not exist yet. */
  path: string;
  exists: boolean;
}

interface Target {
  id: string;
  agent: ConfigAgent;
  scope: ConfigScope;
  root: string;
  parts: string[];
  json: boolean;
  isRule: boolean;
  label: string;
  displayPath: string;
}

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
const within = (root: string, path: string): boolean => path === root || path.startsWith(root + sep);
const hasExtension = (name: string, extensions: string[]): boolean => extensions.some((e) => name.endsWith(e) && name.length > e.length);

/**
 * `ConfigFiles` over the local file system.
 *
 * Guards (this class edits permission and settings files, so each one has a test):
 * - ids map to a fixed allow-list; a rules file name is validated segment by segment (no `..`, no separators, no hidden
 *   names, a known extension, at most three levels);
 * - every path component is checked with `lstat` and a symlink is followed only when its target stays inside the
 *   scope's root, so a link cannot lead a read or a write out of the project or the home directory;
 * - a write presents the hash it was based on and fails with `conflict` when the file changed since;
 * - JSON files must stay valid JSON objects; content must be UTF-8 text without NUL and at most 256 KB;
 * - the replaced version is copied to the backup folder first, and the new one is written to a temporary file and
 *   renamed into place, so a failure never leaves a half-written file and a symlink swapped in at the last moment is
 *   replaced, not followed. A directory swapped for a symlink between the check and the rename is not defended against.
 */
export class FileConfigFiles implements ConfigFiles {
  private readonly now: () => Date;

  constructor(private readonly options: FileConfigFilesOptions) {
    this.now = options.now ?? (() => new Date());
  }

  list(): ConfigFileEntry[] {
    const entries: ConfigFileEntry[] = [];
    for (const def of FIXED) {
      const target = this.fixedTarget(def);
      entries.push(this.entry(target, this.existsSafely(target)));
    }
    for (const folder of RULES) {
      for (const rel of this.ruleFiles(folder)) {
        entries.push(this.entry(this.ruleTarget(folder.agent, folder.scope, rel), true));
      }
    }
    return entries;
  }

  read(id: string): ConfigFileContent {
    const target = this.target(id);
    const resolved = this.resolve(target);
    if (!resolved.exists) return { id, exists: false, content: "", hash: "absent", json: target.json };
    const bytes = this.readBytes(resolved.path);
    return { id, exists: true, content: decode(bytes), hash: sha256(bytes), json: target.json };
  }

  write(id: string, content: string, expectedHash: string): ConfigWriteResult {
    const target = this.target(id);
    this.validateContent(target, content);
    const resolved = this.resolve(target);
    let previous: Buffer | undefined;
    let mode = target.json ? 0o600 : 0o644;
    if (resolved.exists) {
      previous = this.readBytes(resolved.path);
      mode = lstatSync(resolved.path).mode & 0o777;
    }
    const currentHash = previous ? sha256(previous) : "absent";
    if (expectedHash !== currentHash) {
      throw new ConfigFileError("conflict", "The file changed since it was read. Reload it and review the differences again.");
    }
    const backupPath = previous ? this.backup(target, previous) : undefined;
    const bytes = Buffer.from(content, "utf8");
    // Another tool may have written, or a folder may have been swapped for a link, since the first check: look again
    // right before the file is replaced, so that window is as short as it can be.
    this.replace(resolved.path, bytes, mode, () => {
      const again = this.resolve(target);
      if (again.path !== resolved.path || again.exists !== resolved.exists) {
        throw new ConfigFileError("conflict", "The file changed since it was read. Reload it and review the differences again.");
      }
      const now = again.exists ? sha256(this.readBytes(again.path)) : "absent";
      if (now !== currentHash) {
        throw new ConfigFileError("conflict", "The file changed since it was read. Reload it and review the differences again.");
      }
    });
    return { hash: sha256(bytes), ...(backupPath ? { backupPath } : {}) };
  }

  // --- targets -----------------------------------------------------------------------------------------------------

  private root(scope: ConfigScope): string {
    return scope === "project" ? this.options.projectDir : this.options.homeDir;
  }

  private display(scope: ConfigScope, parts: string[]): string {
    return scope === "project" ? parts.join("/") : `~/${parts.join("/")}`;
  }

  private fixedTarget(def: FixedFile): Target {
    return {
      id: `${def.agent}:${def.scope}:${def.slot}`,
      agent: def.agent,
      scope: def.scope,
      root: this.root(def.scope),
      parts: def.parts,
      json: def.json,
      isRule: false,
      label: def.parts[def.parts.length - 1]!,
      displayPath: this.display(def.scope, def.parts),
    };
  }

  private ruleTarget(agent: ConfigAgent, scope: ConfigScope, rel: string[]): Target {
    const folder = RULES.find((f) => f.agent === agent && f.scope === scope)!;
    const parts = [...folder.parts, ...rel];
    return {
      id: `${agent}:${scope}:rules/${rel.join("/")}`,
      agent,
      scope,
      root: this.root(scope),
      parts,
      json: false,
      isRule: true,
      label: rel.join("/"),
      displayPath: this.display(scope, parts),
    };
  }

  /** Maps an id from the caller to a target of the allow-list, or throws `forbidden`. */
  private target(id: unknown): Target {
    const forbidden = new ConfigFileError("forbidden", "Unknown configuration file");
    if (typeof id !== "string") throw forbidden;
    const m = /^(claude|cursor):(project|global):([^:]+)$/.exec(id);
    if (!m) throw forbidden;
    const agent = m[1] as ConfigAgent;
    const scope = m[2] as ConfigScope;
    const slot = m[3]!;
    const fixed = FIXED.find((f) => f.agent === agent && f.scope === scope && f.slot === slot);
    if (fixed) return this.fixedTarget(fixed);
    const folder = RULES.find((f) => f.agent === agent && f.scope === scope);
    if (folder && slot.startsWith("rules/")) {
      const rel = slot.slice("rules/".length).split("/");
      if (rel.length <= MAX_RULE_DEPTH && rel.every((s) => NAME_RE.test(s)) && hasExtension(rel[rel.length - 1]!, folder.extensions)) {
        return this.ruleTarget(agent, scope, rel);
      }
    }
    throw forbidden;
  }

  private entry(target: Target, exists: boolean): ConfigFileEntry {
    return {
      id: target.id,
      agent: target.agent,
      scope: target.scope,
      label: target.label,
      displayPath: target.displayPath,
      isRule: target.isRule,
      exists,
    };
  }

  // --- path confinement --------------------------------------------------------------------------------------------

  /**
   * Walks the target's path below its root. A symlink is followed only when its real target stays inside the root;
   * a dangling link or one that leaves the root is `forbidden`. Components that do not exist yet are appended as is.
   */
  private resolve(target: Target): Resolved {
    let realRoot: string;
    try {
      realRoot = realpathSync(target.root);
    } catch {
      throw new ConfigFileError("io", `The ${target.scope} directory is not available`);
    }
    let current = realRoot;
    for (let i = 0; i < target.parts.length; i++) {
      const next = join(current, target.parts[i]!);
      let stat;
      try {
        stat = lstatSync(next);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return { path: join(current, ...target.parts.slice(i)), exists: false };
        }
        throw new ConfigFileError("io", `Cannot inspect ${target.displayPath}`);
      }
      if (stat.isSymbolicLink()) {
        let real: string;
        try {
          real = realpathSync(next);
        } catch {
          throw new ConfigFileError("forbidden", `${target.displayPath} is a broken symbolic link`);
        }
        if (!within(realRoot, real)) {
          throw new ConfigFileError("forbidden", `${target.displayPath} is a symbolic link that leaves the ${target.scope} directory`);
        }
        current = real;
      } else {
        current = next;
      }
    }
    if (!lstatSync(current).isFile()) throw new ConfigFileError("invalid", `${target.displayPath} is not a regular file`);
    return { path: current, exists: true };
  }

  private existsSafely(target: Target): boolean {
    try {
      return this.resolve(target).exists;
    } catch {
      return false;
    }
  }

  // --- rules folders -----------------------------------------------------------------------------------------------

  private ruleFiles(folder: RulesFolder): string[][] {
    const found: string[][] = [];
    const visit = (rel: string[]): void => {
      let dir: string;
      let names: string[];
      try {
        dir = this.folderPath(folder, rel);
        names = readdirSync(dir).sort();
      } catch {
        return;
      }
      for (const name of names) {
        if (!NAME_RE.test(name)) continue;
        const child = [...rel, name];
        let isDirectory: boolean;
        try {
          isDirectory = lstatSync(join(dir, name)).isDirectory();
        } catch {
          continue;
        }
        if (isDirectory) {
          if (child.length < MAX_RULE_DEPTH) visit(child);
        } else if (hasExtension(name, folder.extensions) && this.existsSafely(this.ruleTarget(folder.agent, folder.scope, child))) {
          found.push(child);
        }
      }
    };
    visit([]);
    return found;
  }

  /** Real path of a rules folder, which must stay inside its root like any file. */
  private folderPath(folder: RulesFolder, rel: string[]): string {
    const realRoot = realpathSync(this.root(folder.scope));
    const real = realpathSync(join(realRoot, ...folder.parts, ...rel));
    if (!within(realRoot, real)) throw new ConfigFileError("forbidden", "Folder leaves its root");
    return real;
  }

  // --- reading and writing -----------------------------------------------------------------------------------------

  private readBytes(path: string): Buffer {
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch {
      throw new ConfigFileError("io", "Cannot read the file");
    }
    if (bytes.length > MAX_CONFIG_BYTES) throw new ConfigFileError("too-large", `The file is larger than ${MAX_CONFIG_BYTES} bytes`);
    return bytes;
  }

  private validateContent(target: Target, content: unknown): asserts content is string {
    if (typeof content !== "string") throw new ConfigFileError("invalid", "content must be a string");
    if (content.includes("\0")) throw new ConfigFileError("invalid", "The content has a NUL character; only text is accepted");
    if (Buffer.byteLength(content, "utf8") > MAX_CONFIG_BYTES) {
      throw new ConfigFileError("too-large", `The content is larger than ${MAX_CONFIG_BYTES} bytes`);
    }
    if (target.json) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (err) {
        throw new ConfigFileError("invalid", `${target.label} must be valid JSON: ${(err as Error).message}`);
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new ConfigFileError("invalid", `${target.label} must be a JSON object`);
      }
    }
  }

  private backup(target: Target, previous: Buffer): string {
    const folder = join(this.options.backupDir, target.id.replace(/[^A-Za-z0-9._-]/g, "_"));
    const stamp = this.now().toISOString().replace(/[:.]/g, "-");
    const base = `${stamp}-${sha256(previous).slice(0, 8)}`;
    try {
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      for (let n = 0; ; n++) {
        const path = join(folder, `${base}${n === 0 ? "" : `-${n}`}.bak`);
        if (existsSync(path)) continue;
        writeFileSync(path, previous, { mode: 0o600, flag: "wx" });
        return path;
      }
    } catch {
      throw new ConfigFileError("io", "Could not back up the current version; nothing was changed");
    }
  }

  private replace(path: string, bytes: Buffer, mode: number, verify: () => void): void {
    const temp = `${path}.knit-${randomBytes(4).toString("hex")}.tmp`;
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(temp, bytes, { mode, flag: "wx" });
      verify();
      renameSync(temp, path);
    } catch (err) {
      rmSync(temp, { force: true });
      if (err instanceof ConfigFileError) throw err;
      throw new ConfigFileError("io", "Could not write the file; the previous version is untouched");
    }
  }
}

function decode(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ConfigFileError("invalid", "The file is not valid UTF-8 text");
  }
}

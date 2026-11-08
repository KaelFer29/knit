/**
 * Port: read and write the configuration files the agent CLIs read (Claude and Cursor, project and global).
 *
 * The set of files is an allow-list owned by the implementation. Callers name a file by an opaque id taken from
 * `list()`; they never pass a path, so there is no path to validate on the caller's side. Writes are guarded
 * (see `ConfigFileError`) and always keep a backup of the version they replace.
 */

export type ConfigAgent = "claude" | "cursor";
export type ConfigScope = "project" | "global";

export interface ConfigFileEntry {
  /** Opaque id, for example `claude:project:settings` or `cursor:project:rules/style.mdc`. */
  id: string;
  agent: ConfigAgent;
  scope: ConfigScope;
  /** Human label, for example `settings.json`. */
  label: string;
  /** Location shown to the user: relative to the project, or starting with `~/`. */
  displayPath: string;
  /** True for the editable files of a rules folder. */
  isRule: boolean;
  exists: boolean;
}

export interface ConfigFileContent {
  id: string;
  exists: boolean;
  content: string;
  /** Fingerprint of `content` (`"absent"` when the file does not exist). A write must present the one it was based on. */
  hash: string;
  /** True when the file is JSON and must stay valid JSON. */
  json: boolean;
}

export interface ConfigWriteResult {
  hash: string;
  /** Absolute path of the copy of the replaced version; undefined when the file did not exist before. */
  backupPath?: string;
}

export type ConfigErrorCode =
  /** Not in the allow-list, or the path escapes its root (traversal, symlink). */
  | "forbidden"
  | "not-found"
  /** Not text, not valid JSON where JSON is required, or an invalid rules file name. */
  | "invalid"
  | "too-large"
  /** The file changed since the caller read it. */
  | "conflict"
  | "io";

export class ConfigFileError extends Error {
  constructor(
    readonly code: ConfigErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConfigFileError";
  }
}

export interface ConfigFiles {
  /** Every allowed file plus the existing files of the rules folders. Does not read contents. */
  list(): ConfigFileEntry[];
  /** Throws `ConfigFileError` (`forbidden` for an id outside the allow-list or a path that escapes its root). */
  read(id: string): ConfigFileContent;
  /**
   * Replaces the file with `content` when its current hash is `expectedHash`, after copying the current version to the
   * backup folder. Creates the file (and its folder) when it does not exist and `expectedHash` is `"absent"`.
   */
  write(id: string, content: string, expectedHash: string): ConfigWriteResult;
}

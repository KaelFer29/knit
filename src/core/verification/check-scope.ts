/**
 * Pure scope check: which changed paths are NOT covered by the task's allowed files.
 * Pattern syntax: exact path, `dir/` (everything under dir), `*` (within one segment),
 * `**` (across segments), `?` (one non-slash character).
 */

function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        i++;
        // `**/` also matches zero directories.
        if (pattern[i + 1] === "/") {
          i++;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (c === "?") {
      source += "[^/]";
    } else {
      source += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

function normalize(path: string): string {
  return path.replace(/^\.\//, "");
}

function escapesRepo(path: string): boolean {
  return path.startsWith("/") || path.split("/").includes("..");
}

function isAllowed(path: string, patterns: string[]): boolean {
  if (escapesRepo(path)) return false;
  return patterns.some((raw) => {
    const pattern = normalize(raw);
    if (pattern.endsWith("/")) return path.startsWith(pattern);
    return globToRegExp(pattern).test(path);
  });
}

/** Returns the changed paths that violate the allowed list, preserving input order. */
export function checkScope(changedPaths: string[], allowedFiles: string[]): string[] {
  return changedPaths.map(normalize).filter((p) => !isAllowed(p, allowedFiles));
}

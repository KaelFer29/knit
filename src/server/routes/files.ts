import { FileTreeError, type FileTree } from "../../core/ports/file-tree.js";
import type { RunSnapshot } from "../../core/ports/run-reader.js";
import { HttpError, sendJson } from "../http.js";
import type { RouteModule } from "../types.js";
import { requireSnapshot } from "./runs.js";

/** The explorer id of the target repository; every other root id is a task id. */
export const REPO_ROOT_ID = "repo";

interface Root {
  id: string;
  label: string;
  /** Absolute directory. Taken from the run record, never from the request. */
  dir: string;
}

/** The directories a run may expose: its repository and the worktree of every task that has one. */
function rootsOf(snapshot: RunSnapshot): Root[] {
  const roots: Root[] = [{ id: REPO_ROOT_ID, label: "Repository", dir: snapshot.run.repo }];
  for (const task of snapshot.tasks) {
    if (task.worktree) roots.push({ id: task.taskId, label: `${task.taskId} ${task.title}`, dir: task.worktree });
  }
  return roots;
}

function requireTree(files: FileTree | undefined): FileTree {
  if (!files) throw new HttpError(503, "The file explorer is not available");
  return files;
}

function resolveRoot(snapshot: RunSnapshot, id: string | null): Root {
  if (!id) throw new HttpError(400, "root is required");
  const root = rootsOf(snapshot).find((r) => r.id === id);
  if (!root) throw new HttpError(404, `Root not found: ${id}`);
  return root;
}

/** Maps the port's failures to HTTP; anything else is a bug and propagates. */
function guarded<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (!(err instanceof FileTreeError)) throw err;
    if (err.code === "outside") throw new HttpError(403, err.message);
    if (err.code === "not-found") throw new HttpError(404, err.message);
    throw new HttpError(400, err.message);
  }
}

/** Read-only explorer routes: the roots of a run, one directory level, and one file. */
export const filesRoutes: RouteModule = ({ reader, files }) => [
  {
    method: "GET",
    pattern: "/api/runs/:id/roots",
    handler: ({ res, params }) => {
      const roots = rootsOf(requireSnapshot(reader, params.id!)).map(({ id, label }) => ({ id, label }));
      sendJson(res, 200, { roots });
    },
  },
  {
    method: "GET",
    pattern: "/api/runs/:id/files",
    handler: ({ res, params, url }) => {
      const tree = requireTree(files);
      const root = resolveRoot(requireSnapshot(reader, params.id!), url.searchParams.get("root"));
      const listing = guarded(() => tree.list(root.dir, url.searchParams.get("path") ?? ""));
      sendJson(res, 200, { root: root.id, ...listing });
    },
  },
  {
    method: "GET",
    pattern: "/api/runs/:id/file",
    handler: ({ res, params, url }) => {
      const tree = requireTree(files);
      const root = resolveRoot(requireSnapshot(reader, params.id!), url.searchParams.get("root"));
      const path = url.searchParams.get("path");
      if (!path) throw new HttpError(400, "path is required");
      const content = guarded(() => tree.read(root.dir, path));
      sendJson(res, 200, { root: root.id, ...content });
    },
  },
];

import type { RouteModule } from "../types.js";
import { activityRoutes } from "./activity.js";
import { branchesRoutes } from "./branches.js";
import { configRoutes } from "./config.js";
import { controlRoutes } from "./control.js";
import { filesRoutes } from "./files.js";
import { diffRoutes } from "./diff.js";
import { plansRoutes } from "./plans.js";
import { runsRoutes } from "./runs.js";
import { sessionsRoutes } from "./sessions.js";
import { streamRoutes } from "./stream.js";

/**
 * Every route module of the server. A task that adds routes creates `routes/<name>.ts` and adds ONE line here.
 * All of them sit behind the same security guard (`security.ts`), so a new route cannot skip it.
 */
export const routeModules: RouteModule[] = [
  runsRoutes,
  controlRoutes,
  streamRoutes,
  filesRoutes,
  diffRoutes,
  branchesRoutes,
  activityRoutes,
  configRoutes,
  sessionsRoutes,
  plansRoutes,
];

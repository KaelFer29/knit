import { ConfigView } from "./containers/ConfigView";
import { FilesView } from "./containers/FilesView";
import { FlowView } from "./containers/FlowView";
import { demoFilesApi } from "./files/demo";
import { httpFilesApi } from "./files/api";
import { WorkspaceView } from "./containers/WorkspaceView";
import { NavTabs } from "./molecules/NavTabs";
import { ThemeToggle } from "./molecules/ThemeToggle";
import { AppShell } from "./organisms/AppShell";
import { useRoute } from "./route";
import { useTheme } from "./theme/useTheme";

/** `?view=files&run=<id>` opens the file explorer of a run; `&demo=1` uses built-in sample files instead. */
function filesApiFor(search: string) {
  const params = new URLSearchParams(search);
  if (params.get("view") !== "files") return undefined;
  const run = params.get("run");
  if (params.get("demo") === "1" || !run) return demoFilesApi();
  return httpFilesApi(run);
}

const LABELS = { runs: "Run canvas", workspace: "Workspace", config: "Configuration" } as const;

/** Container: owns the theme and the route, and wires them to the presentational shell. */
export function App() {
  const [theme, setTheme] = useTheme();
  const route = useRoute();
  const filesApi = filesApiFor(window.location.search);
  return (
    <AppShell nav={<NavTabs current={route.view} />} label={filesApi ? "Files" : LABELS[route.view]} actions={<ThemeToggle value={theme} onChange={setTheme} />}>
      {filesApi ? <FilesView api={filesApi} /> : route.view === "workspace" ? <WorkspaceView sessionId={route.sessionId} /> : route.view === "config" ? <ConfigView /> : <FlowView />}
    </AppShell>
  );
}

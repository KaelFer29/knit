import { ConfigView } from "./containers/ConfigView";
import { FilesView } from "./containers/FilesView";
import { FlowView } from "./containers/FlowView";
import { demoFilesApi } from "./files/demo";
import { httpFilesApi } from "./files/api";
import { ThemeToggle } from "./molecules/ThemeToggle";
import { ViewTabs } from "./molecules/ViewTabs";
import { useView } from "./nav/useView";
import { AppShell } from "./organisms/AppShell";
import { useTheme } from "./theme/useTheme";

/** `?view=files&run=<id>` opens the file explorer of a run; `&demo=1` uses built-in sample files instead. */
function filesApiFor(search: string) {
  const params = new URLSearchParams(search);
  if (params.get("view") !== "files") return undefined;
  const run = params.get("run");
  if (params.get("demo") === "1" || !run) return demoFilesApi();
  return httpFilesApi(run);
}

/** Container: owns the theme and the current view and wires them to the presentational shell. */
export function App() {
  const [theme, setTheme] = useTheme();
  const [view, setView] = useView();
  const filesApi = filesApiFor(window.location.search);
  return (
    <AppShell actions={<ThemeToggle value={theme} onChange={setTheme} />}>
      <ViewTabs value={view} onChange={setView} />
      {filesApi ? <FilesView api={filesApi} /> : view === "config" ? <ConfigView /> : <FlowView />}
    </AppShell>
  );
}

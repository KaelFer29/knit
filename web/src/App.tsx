import { SingleView } from "./containers/SingleView";
import { ThemeToggle } from "./molecules/ThemeToggle";
import { useTheme } from "./theme/useTheme";

/** Container: owns the theme and hands it to the single view, the only screen of the app. */
export function App() {
  const [theme, setTheme] = useTheme();
  return <SingleView actions={<ThemeToggle value={theme} onChange={setTheme} />} />;
}

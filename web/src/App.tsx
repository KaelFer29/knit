import { ThemeToggle } from "./molecules/ThemeToggle";
import { AppShell } from "./organisms/AppShell";
import { EmptyCanvas } from "./organisms/EmptyCanvas";
import { useTheme } from "./theme/useTheme";

/** Container: owns the theme state and wires it to the presentational shell. */
export function App() {
  const [theme, setTheme] = useTheme();
  return (
    <AppShell actions={<ThemeToggle value={theme} onChange={setTheme} />}>
      <EmptyCanvas />
    </AppShell>
  );
}

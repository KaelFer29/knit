import "./NavTabs.css";

export type View = "runs" | "workspace" | "config";

const TABS: { view: View; label: string }[] = [
  { view: "runs", label: "Runs" },
  { view: "workspace", label: "Workspace" },
  { view: "config", label: "Configuration" },
];

/** Main navigation. Plain links to hash routes, so keyboard use and the back button work without any script. */
export function NavTabs({ current }: { current: View }) {
  return (
    <nav className="nav-tabs" aria-label="Main">
      {TABS.map((tab) => (
        <a key={tab.view} className="nav-tabs__link" href={`#/${tab.view}`} aria-current={tab.view === current ? "page" : undefined}>
          {tab.label}
        </a>
      ))}
    </nav>
  );
}

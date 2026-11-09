import type { ReactNode } from "react";
import "./WorkspaceLayout.css";

/** Two columns: the session list on the left, the open conversation on the right. */
export function WorkspaceLayout({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="workspace">
      <aside className="workspace__sidebar">{sidebar}</aside>
      <section className="workspace__main" aria-label="Conversation">
        {children}
      </section>
    </div>
  );
}

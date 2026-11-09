import { useEffect, useState } from "react";
import { fetchAgentList } from "./api";

/** Container hook: the directory `knit ui` was launched in, read once while `enabled`. Undefined until known or without a server. */
export function useWorkspace(enabled: boolean): string | undefined {
  const [cwd, setCwd] = useState<string | undefined>();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchAgentList().then(
      (list) => live && setCwd(list.cwd),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [enabled]);
  return cwd;
}

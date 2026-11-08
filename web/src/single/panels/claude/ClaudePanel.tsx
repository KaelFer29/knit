import { WorkspaceView } from "../../../containers/WorkspaceView";
import { useRoute } from "../../../route";

/** Claude's panel body. For now the existing sessions workspace; task U3 replaces it. */
export function ClaudePanel() {
  return <WorkspaceView sessionId={useRoute().sessionId} />;
}

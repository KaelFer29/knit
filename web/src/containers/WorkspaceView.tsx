import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "../api/client";
import { identityOf } from "../identity/agents";
import { Composer } from "../organisms/Composer";
import { NewSessionHeader } from "../organisms/NewSessionHeader";
import { SessionHeader } from "../organisms/SessionHeader";
import { SessionList } from "../organisms/SessionList";
import { Timeline } from "../organisms/Timeline";
import { UsagePanel } from "../organisms/UsagePanel";
import { WorkspaceLayout } from "../organisms/WorkspaceLayout";
import { NEW_SESSION, workspaceHash } from "../route";
import { fetchAgents, fetchModels, fetchSessions, sendTurn, startSession } from "../sessions/api";
import { paletteCommands } from "../sessions/commands";
import { buildTimeline } from "../sessions/timeline";
import type { AgentView, Profile, SessionListEntry } from "../sessions/types";
import { useSessionLive } from "../sessions/useSessionLive";
import "./WorkspaceView.css";

export const LIST_POLL_MS = 3000;
const CWD_KEY = "knit.workspace.cwd";

const NO_CAPABILITIES = { resume: false, chooseModel: false, commandList: false, visibleReasoning: false, planUsage: false };

function readCwd(): string {
  try {
    return window.localStorage.getItem(CWD_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberCwd(cwd: string): void {
  try {
    window.localStorage.setItem(CWD_KEY, cwd);
  } catch {
    // Storage can be blocked; the field simply starts empty next time.
  }
}

const messageOf = (err: unknown): string => (err instanceof ApiError || err instanceof Error ? err.message : String(err));

interface Props {
  /** A session id, `new`, or undefined (which shows the new-session form). */
  sessionId?: string | undefined;
}

/**
 * Container: the sessions workspace. It fetches agents, the session list and the open session, owns the composer's
 * choices, starts turns through the API and hands everything to presentational components. What each agent can do
 * comes from its capabilities in `GET /api/agents`; nothing here looks at an agent's name.
 */
export function WorkspaceView({ sessionId }: Props) {
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [sessions, setSessions] = useState<SessionListEntry[]>([]);
  const [listError, setListError] = useState<string | undefined>();
  const [draftAgent, setDraftAgent] = useState<string | undefined>();
  const [cwd, setCwd] = useState(readCwd);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [usageOpen, setUsageOpen] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | undefined>();
  const [now, setNow] = useState(() => Date.now());

  const isNew = sessionId === undefined || sessionId === NEW_SESSION;
  const live = useSessionLive(isNew ? undefined : sessionId);

  const loadSessions = useCallback(async (): Promise<void> => {
    try {
      setSessions(await fetchSessions());
      setListError(undefined);
    } catch (err) {
      setListError(messageOf(err));
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    fetchAgents().then(
      (list) => !stopped && setAgents(list),
      (err: unknown) => !stopped && setListError(messageOf(err)),
    );
    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => {
    void loadSessions();
    const timer = setInterval(() => {
      void loadSessions();
      setNow(Date.now());
    }, LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [loadSessions]);

  const session = live.detail?.session;
  const activeId = isNew ? (draftAgent ?? agents[0]?.id) : session?.agent;
  const agent: AgentView | undefined = useMemo(() => {
    if (activeId === undefined) return undefined;
    return agents.find((a) => a.id === activeId) ?? (isNew ? undefined : { id: activeId, label: activeId, capabilities: NO_CAPABILITIES, profileFields: [] });
  }, [agents, activeId, isNew]);

  // The model picker is filled from the agent, once, and only for an agent that can choose.
  const wantsModels = agent?.capabilities.chooseModel === true && models[agent.id] === undefined;
  const agentId = agent?.id;
  useEffect(() => {
    if (!wantsModels || agentId === undefined) return;
    let stopped = false;
    fetchModels(agentId).then(
      (list) => !stopped && setModels((m) => ({ ...m, [agentId]: list })),
      () => !stopped && setModels((m) => ({ ...m, [agentId]: [] })),
    );
    return () => {
      stopped = true;
    };
  }, [wantsModels, agentId]);

  const items = useMemo(() => (live.detail ? buildTimeline(live.detail.turns, live.events) : []), [live.detail, live.events]);
  const commands = useMemo(() => paletteCommands(agent, live.detail?.meta.commands ?? []), [agent, live.detail]);

  const go = (id?: string): void => {
    setSendError(undefined);
    window.location.hash = workspaceHash(id);
  };

  const submit = async (prompt: string): Promise<boolean> => {
    if (agent === undefined) return false;
    const profile = profiles[agent.id] ?? {};
    setSending(true);
    setSendError(undefined);
    try {
      if (isNew) {
        const directory = cwd.trim();
        if (directory === "") throw new Error("Enter the directory the agent should work in.");
        const id = await startSession({ agent: agent.id, cwd: directory, prompt, profile });
        rememberCwd(directory);
        void loadSessions();
        go(id);
      } else {
        await sendTurn(sessionId!, prompt, profile);
        live.refresh();
        void loadSessions();
      }
      return true;
    } catch (err) {
      setSendError(messageOf(err));
      return false;
    } finally {
      setSending(false);
    }
  };

  const onKnitCommand = (name: string): void => {
    if (name === "clear") go(NEW_SESSION);
    else if (name === "usage") setUsageOpen(true);
  };

  const running = session?.status === "running";
  const cannotContinue = !isNew && agent !== undefined && !agent.capabilities.resume && session?.agentSessionId !== undefined;
  const tokens = live.detail
    ? live.detail.turns.reduce((sum, t) => ({ input: sum.input + (t.inputTokens ?? 0), output: sum.output + (t.outputTokens ?? 0) }), { input: 0, output: 0 })
    : { input: 0, output: 0 };

  const sidebar = (
    <>
      <SessionList sessions={sessions} agents={agents} selectedId={isNew ? undefined : sessionId} now={now} onSelect={(id) => go(id)} onNew={() => go(NEW_SESSION)} />
      {listError ? (
        <p className="workspace__error" role="alert">
          {listError}
        </p>
      ) : null}
    </>
  );

  return (
    <WorkspaceLayout sidebar={sidebar}>
      {isNew ? (
        agent === undefined ? (
          <p className="workspace__note">{agents.length === 0 ? "No agents are available on this server." : "Loading…"}</p>
        ) : (
          <>
            <NewSessionHeader agents={agents} agentId={agent.id} cwd={cwd} onAgentChange={setDraftAgent} onCwdChange={setCwd} />
            <Timeline items={[]} emptyText={`Start a conversation with ${agent.label}. The first message creates the session.`} />
          </>
        )
      ) : session === undefined ? (
        <p className="workspace__note" role={live.error ? "alert" : "status"}>
          {live.error ?? "Loading session…"}
        </p>
      ) : (
        <>
          <SessionHeader
            session={session}
            identity={identityOf(session.agent, agent?.label)}
            {...(live.detail?.continueCommand ? { continueCommand: live.detail.continueCommand } : {})}
            usageOpen={usageOpen}
            onToggleUsage={() => setUsageOpen((open) => !open)}
          />
          {usageOpen && agent ? (
            <UsagePanel reportsPlanUsage={agent.capabilities.planUsage} planUsage={live.detail?.meta.planUsage ?? []} inputTokens={tokens.input} outputTokens={tokens.output} now={now} />
          ) : null}
          <Timeline items={items} emptyText="No messages yet." />
          {live.error ? (
            <p className="workspace__error" role="alert">
              {live.error}
            </p>
          ) : null}
        </>
      )}
      {agent !== undefined && (isNew || session !== undefined) ? (
        cannotContinue ? (
          <p className="workspace__note">{agent.label} cannot continue this conversation here. Start a new session to keep working.</p>
        ) : (
          <Composer
            key={isNew ? `new-${agent.id}` : sessionId}
            agent={agent}
            models={models[agent.id] ?? []}
            profile={profiles[agent.id] ?? {}}
            onProfileChange={(p) => setProfiles((all) => ({ ...all, [agent.id]: p }))}
            commands={commands}
            onSubmit={submit}
            onKnitCommand={onKnitCommand}
            busy={sending || running}
            busyLabel={sending ? "Starting the turn…" : "A turn is running…"}
            {...(sendError ? { error: sendError } : {})}
          />
        )
      ) : null}
    </WorkspaceLayout>
  );
}

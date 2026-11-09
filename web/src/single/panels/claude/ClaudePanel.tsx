import type { PanelProps } from "../registry";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "../../../api/client";
import { PlanDrafts } from "../../../organisms/PlanDrafts";
import { Composer } from "../../../organisms/Composer";
import { NewSessionHeader } from "../../../organisms/NewSessionHeader";
import { Timeline } from "../../../organisms/Timeline";
import { UsagePanel } from "../../../organisms/UsagePanel";
import { CopyCommand } from "../../../molecules/CopyCommand";
import { fetchAgents, fetchModels, fetchSessions, sendTurn, startSession } from "../../../sessions/api";
import { launchPlan, type PlanDraftView } from "../../../sessions/plans";
import { paletteCommands, usageAction } from "../../../sessions/commands";
import { routedPrompt } from "../../../sessions/route";
import { buildTimeline } from "../../../sessions/timeline";
import type { AgentView, Profile, SessionListEntry } from "../../../sessions/types";
import { usePlanDrafts } from "../../../sessions/usePlanDrafts";
import { useSessionLive } from "../../../sessions/useSessionLive";
import { ClaudePanelHeader } from "./ClaudePanelHeader";
import "./ClaudePanel.css";

export const LIST_POLL_MS = 3000;
const NEW_SESSION = "new";
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

/**
 * Container: Claude's modal. It fetches agents, the session list and the open session, owns the composer's
 * choices, starts turns through the API and hands everything to presentational components. The open session lives
 * in panel state (it defaults to the most recent one); the URL carries no session. What each agent can do comes from
 * its capabilities in `GET /api/agents`; nothing here looks at an agent's name. A turn never starts a run: only the
 * explicit "Send plan to the orchestrator" click does.
 */
export function ClaudePanel(_props: PanelProps) {
  const [picked, setPicked] = useState<string | undefined>();
  const [listed, setListed] = useState(false);
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [sessions, setSessions] = useState<SessionListEntry[]>([]);
  const [listError, setListError] = useState<string | undefined>();
  const [draftAgent, setDraftAgent] = useState<string | undefined>();
  const [cwd, setCwd] = useState(readCwd);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [routeOn, setRouteOn] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | undefined>();
  const [now, setNow] = useState(() => Date.now());

  const sessionId = picked ?? (listed ? sessions[0]?.session.id : undefined);
  const isNew = sessionId === undefined || sessionId === NEW_SESSION;
  const live = useSessionLive(isNew ? undefined : sessionId);
  const drafts = usePlanDrafts(isNew ? undefined : sessionId);
  const [launching, setLaunching] = useState<string | undefined>();
  const [launchError, setLaunchError] = useState<string | undefined>();

  const loadSessions = useCallback(async (): Promise<void> => {
    try {
      setSessions(await fetchSessions());
      setListed(true);
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
    setPicked(id ?? NEW_SESSION);
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

  /** The only way a run starts from a conversation: the user clicks Launch on a valid draft. */
  const launch = async (plan: PlanDraftView): Promise<void> => {
    setLaunching(plan.path);
    setLaunchError(undefined);
    try {
      await launchPlan(plan.path);
      drafts.refresh();
    } catch (err) {
      setLaunchError(messageOf(err));
    } finally {
      setLaunching(undefined);
    }
  };

  const onKnitCommand = (name: string): void => {
    if (name === "clear") go(NEW_SESSION);
    else if (name === "usage" && agent) {
      const action = usageAction(agent);
      if (action.kind === "send") void submit(action.prompt);
      else setSendError(action.text);
    }
  };

  const running = session?.status === "running";
  const cannotContinue = !isNew && agent !== undefined && !agent.capabilities.resume && session?.agentSessionId !== undefined;
  const tokens = live.detail
    ? live.detail.turns.reduce((sum, t) => ({ input: sum.input + (t.inputTokens ?? 0), output: sum.output + (t.outputTokens ?? 0) }), { input: 0, output: 0 })
    : { input: 0, output: 0 };

  const continueCommand = live.detail?.continueCommand;

  return (
    <div className="claude-panel">
      <ClaudePanelHeader
        sessions={sessions}
        agents={agents}
        selectedId={isNew ? undefined : sessionId}
        session={isNew ? undefined : session}
        agent={agent}
        profile={agent ? (profiles[agent.id] ?? {}) : {}}
        onSelect={(id) => go(id)}
        onNew={() => go(NEW_SESSION)}
      />
      {listError ? (
        <p className="claude-panel__error" role="alert">
          {listError}
        </p>
      ) : null}
      <div className="claude-panel__scroll">
        {isNew ? (
          agent === undefined ? (
            <p className="claude-panel__note">{agents.length === 0 ? "No agents are available on this server." : "Loading…"}</p>
          ) : (
            <>
              <NewSessionHeader agents={agents} agentId={agent.id} cwd={cwd} onAgentChange={setDraftAgent} onCwdChange={setCwd} />
              <Timeline items={[]} emptyText={`Start a conversation with ${agent.label}. The first message creates the session.`} />
            </>
          )
        ) : session === undefined ? (
          <p className="claude-panel__note" role={live.error ? "alert" : "status"}>
            {live.error ?? "Loading session…"}
          </p>
        ) : (
          <>
            <Timeline items={items} emptyText="No messages yet." />
            <aside className="claude-panel__side" aria-label="Usage and plans">
              {agent ? (
                <UsagePanel compact reportsPlanUsage={agent.capabilities.planUsage} planUsage={live.detail?.meta.planUsage ?? []} inputTokens={tokens.input} outputTokens={tokens.output} now={now} />
              ) : null}
              {drafts.listing ? <PlanDrafts dir={drafts.listing.dir} plans={drafts.listing.plans} launching={launching} error={launchError} onLaunch={(plan) => void launch(plan)} /> : null}
              {continueCommand ? <CopyCommand command={continueCommand} /> : null}
            </aside>
            {live.error ? (
              <p className="claude-panel__error" role="alert">
                {live.error}
              </p>
            ) : null}
          </>
        )}
      </div>
      {agent !== undefined && (isNew || session !== undefined) ? (
        cannotContinue ? (
          <p className="claude-panel__note">{agent.label} cannot continue this conversation here. Start a new session to keep working.</p>
        ) : (
          <Composer
            key={isNew ? `new-${agent.id}` : sessionId}
            agent={agent}
            models={models[agent.id] ?? []}
            profile={profiles[agent.id] ?? {}}
            onProfileChange={(p) => setProfiles((all) => ({ ...all, [agent.id]: p }))}
            commands={commands}
            onSubmit={(prompt) => submit(routeOn && !prompt.startsWith("/") ? routedPrompt(prompt) : prompt)}
            routing={{ on: routeOn, onChange: setRouteOn }}
            onKnitCommand={onKnitCommand}
            busy={sending || running}
            busyLabel={sending ? "Starting the turn…" : "A turn is running…"}
            {...(sendError ? { error: sendError } : {})}
          />
        )
      ) : null}
    </div>
  );
}

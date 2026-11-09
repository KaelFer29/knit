import type { PanelProps } from "../registry";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "../../../api/client";
import { FollowupDraft } from "../../../organisms/FollowupDraft";
import { IterateBar } from "../../../organisms/IterateBar";
import { PlanDrafts } from "../../../organisms/PlanDrafts";
import { Composer } from "../../../organisms/Composer";
import { Timeline } from "../../../organisms/Timeline";
import { PlanUsageCard } from "../../../organisms/PlanUsageCard";
import { ClaudeAtWork } from "../../../molecules/ClaudeAtWork";
import { usePlanUsage } from "../../../sessions/usePlanUsage";
import { useSessionTitles } from "../../../sessions/useSessionTitles";
import { fetchAgentList, fetchModels, fetchSessions, sendTurn, startSession } from "../../../sessions/api";
import { identityOf } from "../../../identity/agents";
import { sendFollowup } from "../../../runs/api";
import { extractFollowup, iterationPrompt } from "../../../sessions/iterate";
import { launchPlan, type PlanDraftView } from "../../../sessions/plans";
import { paletteCommands, usageAction } from "../../../sessions/commands";
import { routedPrompt } from "../../../sessions/route";
import { buildTimeline } from "../../../sessions/timeline";
import type { AgentView, Profile, SessionListEntry } from "../../../sessions/types";
import { usePlanDrafts } from "../../../sessions/usePlanDrafts";
import { useSessionLive } from "../../../sessions/useSessionLive";
import { ClaudePanelHeader } from "./ClaudePanelHeader";
import { EmptyConversation } from "./EmptyConversation";
import "./ClaudePanel.css";

export const LIST_POLL_MS = 3000;
const NEW_SESSION = "new";
const NO_CAPABILITIES = { resume: false, chooseModel: false, commandList: false, visibleReasoning: false, planUsage: false };

const messageOf = (err: unknown): string => (err instanceof ApiError || err instanceof Error ? err.message : String(err));

/**
 * Container: Claude's modal. It fetches agents, the session list and the open session, owns the composer's
 * choices, starts turns through the API and hands everything to presentational components. The open session lives
 * in panel state (it defaults to the most recent one); the URL carries no session. What each agent can do comes from
 * its capabilities in `GET /api/agents`; nothing here looks at an agent's name. A turn never starts a run: only the
 * explicit "Send plan to the orchestrator" click does.
 */
export function ClaudePanel({ agentId: panelAgent, board, runId, live: runIsLive, selectRun, openPanel }: PanelProps) {
  const [picked, setPicked] = useState<string | undefined>();
  const [listed, setListed] = useState(false);
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [sessions, setSessions] = useState<SessionListEntry[]>([]);
  const [listError, setListError] = useState<string | undefined>();
  const [serverCwd, setServerCwd] = useState<string | undefined>();
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [routeOn, setRouteOn] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(true);
  /** The delivered task the person is iterating on, and whether the list of tasks is open. */
  const [iterating, setIterating] = useState<string | undefined>();
  /** Runs started from a draft since the last prompt: shown as a small line until the next prompt is sent. */
  const [launched, setLaunched] = useState<{ runId: string; path: string }[]>([]);
  const { titleOf, rename } = useSessionTitles();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | undefined>();
  const [now, setNow] = useState(() => Date.now());

  // The panel is about one agent: its own sessions only, and new ones are started with it.
  const wanted = panelAgent ?? agents[0]?.id;
  const mine = useMemo(() => sessions.filter((e) => e.session.agent === wanted), [sessions, wanted]);
  const sessionId = picked ?? (listed ? mine[0]?.session.id : undefined);
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
    fetchAgentList().then(
      (list) => {
        if (stopped) return;
        setAgents(list.agents);
        setServerCwd(list.cwd);
      },
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
  const activeId = wanted;
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

  const usage = usePlanUsage(agent?.id, agent?.capabilities.planUsage === true);
  const items = useMemo(() => (live.detail ? buildTimeline(live.detail.turns, live.events) : []), [live.detail, live.events]);
  const commands = useMemo(() => paletteCommands(agent, live.detail?.meta.commands ?? []), [agent, live.detail]);

  const go = (id?: string): void => {
    setSendError(undefined);
    setPicked(id ?? NEW_SESSION);
  };

  const submit = async (prompt: string): Promise<boolean> => {
    if (agent === undefined) return false;
    const profile = profiles[agent.id] ?? {};
    setLaunched([]);
    setSending(true);
    setSendError(undefined);
    try {
      if (isNew) {
        const directory = serverCwd ?? mine[0]?.session.cwd;
        if (directory === undefined) throw new Error("The server did not say which directory to work in.");
        const id = await startSession({ agent: agent.id, cwd: directory, prompt, profile });
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
      const runId = await launchPlan(plan.path);
      setLaunched((all) => [...all, { runId, path: plan.path }]);
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

  // The delivered tasks of a real run can be iterated on: the same branch, the same Cursor chat, a new attempt.
  const targets = useMemo(
    () =>
      runIsLive && runId !== undefined && board !== undefined
        ? board.tasks.filter((t) => t.state === "delivered" && t.branch !== undefined).map((t) => ({ taskId: t.taskId, title: t.title, branch: t.branch, goal: t.goal, specs: t.specs }))
        : [],
    [board, runId, runIsLive],
  );
  const target = targets.find((t) => t.taskId === iterating);
  const latestTurn = live.detail?.turns[live.detail.turns.length - 1];
  // What Claude wrote for the chosen task in its last answer; nothing is sent before the person clicks.
  const instruction = target !== undefined && latestTurn?.status === "passed" ? extractFollowup(latestTurn.resultText) : undefined;
  /** What goes to the agent: a command as typed, the request with the chosen task's context, or the request routed to a plan. */
  const prepare = (prompt: string): string => (prompt.startsWith("/") ? prompt : target !== undefined ? iterationPrompt(target, prompt) : routeOn ? routedPrompt(prompt) : prompt);

  const running = session?.status === "running";
  const cannotContinue = !isNew && agent !== undefined && !agent.capabilities.resume && session?.agentSessionId !== undefined;
  const tokens = live.detail
    ? live.detail.turns.reduce((sum, t) => ({ input: sum.input + (t.inputTokens ?? 0), output: sum.output + (t.outputTokens ?? 0) }), { input: 0, output: 0 })
    : { input: 0, output: 0 };

  // A plan already run since it was last written is not offered again; one rewritten after its run is.
  const pending = (drafts.listing?.plans ?? []).filter((p) => !launched.some((l) => l.path === p.path) && !p.runs.some((r) => Date.parse(r.startedAt) > Date.parse(p.modifiedAt)));
  const statusOf = (l: { runId: string; path: string }): string => drafts.listing?.plans.find((p) => p.path === l.path)?.runs.find((r) => r.id === l.runId)?.status ?? "starting";

  const usageView = (
    <aside className="claude-panel__aside" aria-label="Usage and status">
      <ClaudeAtWork working={running} tokens={tokens} />
      {agent?.capabilities.planUsage ? <PlanUsageCard windows={usage.windows} checkedAt={usage.checkedAt} now={now} loading={usage.loading} error={usage.error} onRefresh={usage.refresh} /> : null}
    </aside>
  );

  return (
    <div className="claude-panel">
      <ClaudePanelHeader sessions={mine} selectedId={isNew ? undefined : sessionId} session={isNew ? undefined : session} titleOf={titleOf} onRename={rename} now={now} onSelect={(id) => go(id)} onNew={() => go(NEW_SESSION)} />
      {listError ? (
        <p className="claude-panel__error" role="alert">
          {listError}
        </p>
      ) : null}
      <div className="claude-panel__body">
        <section className="claude-panel__chat" aria-label="Chat">
          {isNew ? (
            agent === undefined ? (
              <p className="claude-panel__note">{agents.length === 0 ? "No agents are available on this server." : `${identityOf(wanted ?? "", wanted).label} is not available on this server.`}</p>
            ) : (
              <EmptyConversation identity={identityOf(agent.id, agent.label)} />
            )
          ) : session === undefined ? (
            <p className="claude-panel__note" role={live.error ? "alert" : "status"}>
              {live.error ?? "Loading session…"}
            </p>
          ) : (
            <>
              <Timeline items={items} emptyText="No messages yet." />
              {pending.length > 0 || launched.length > 0 ? (
                <div className="claude-panel__overlay">
                  {launched.length > 0 ? (
                    <div className="claude-panel__runs" role="group" aria-label="Runs started">
                      <span className="claude-panel__runs-label">Runs:</span>
                      {launched.map((l) => (
                        <button
                          key={l.runId}
                          type="button"
                          className="claude-panel__run"
                          onClick={() => {
                            selectRun(l.runId);
                            openPanel?.("knit");
                          }}
                        >
                          {l.runId.slice(0, 8)} · {statusOf(l)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {pending.length > 0 ? (
                    <>
                      <button type="button" className="claude-panel__drafts-toggle" aria-expanded={draftsOpen} aria-controls="claude-drafts" onClick={() => setDraftsOpen((v) => !v)}>
                        <span>
                          Draft plans <span className="claude-panel__count">{pending.length}</span>
                        </span>
                        <span className="claude-panel__chevron" aria-hidden="true">
                          ▾
                        </span>
                      </button>
                      {draftsOpen && drafts.listing ? (
                        <div id="claude-drafts" className="claude-panel__drafts">
                          <PlanDrafts dir={drafts.listing.dir} plans={pending} launching={launching} error={launchError} onLaunch={(plan) => void launch(plan)} />
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
              {live.error ? (
                <p className="claude-panel__error" role="alert">
                  {live.error}
                </p>
              ) : null}
            </>
          )}
        </section>
        {usageView}
      </div>
      {targets.length > 0 ? (
        <div className="claude-panel__iterate">
          <IterateBar
            tasks={targets}
            selected={iterating}
            onSelect={(id) => {
              setIterating(id);
              // The follow-up already goes to the orchestrator: routing the same prompt to a plan too would send two contexts.
              if (id !== undefined) setRouteOn(false);
            }}
          />
          {instruction === undefined || target === undefined || runId === undefined ? null : (
            <FollowupDraft
              key={`${latestTurn!.id}-${target.taskId}`}
              taskId={target.taskId}
              initial={instruction}
              onSend={async (text) => {
                await sendFollowup(runId, target.taskId, text);
              }}
              onOpenCursor={openPanel ? () => openPanel("cursor") : undefined}
            />
          )}
        </div>
      ) : null}
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
            onSubmit={(prompt) => submit(prepare(prompt))}
            routing={{
              on: routeOn && target === undefined,
              onChange: setRouteOn,
              ...(target === undefined ? {} : { disabled: true, reason: `Off while a correction for ${target.taskId} is prepared: it goes to the orchestrator only when you send it.` }),
            }}
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

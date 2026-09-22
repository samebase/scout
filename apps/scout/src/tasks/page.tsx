import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import {
  HANDOFF_DECLINED_REASON,
  HANDOFF_EXPIRED_REASON,
  handoffDeadlineMessage,
} from "../../shared/handoff";
import { SidebarLayout } from "@samebase/sidebars/SidebarLayout";
import { useSidebarActions, useSidebarLayoutPresentation } from "@samebase/sidebars/SidebarRuntime";
import { Link, useNavigate, type ErrorComponentProps } from "@tanstack/react-router";
import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import {
  FolderIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlusIcon,
  RotateCcwIcon,
  SendIcon,
  SquareIcon,
  CheckIcon,
  XIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  SearchIcon,
  ImagesIcon,
  ArrowUpRightIcon,
} from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { api } from "../../convex/_generated/api";
import { ConvexError } from "convex/values";
import { scoutAvailabilityLabels } from "#components/scout-current-activity";
import { omitNullish } from "../../shared/omitNullish";
import { Button } from "#components/ui/button";
import { Textarea } from "#components/ui/textarea";
import {
  selectedCheckId,
  selectedStep,
  sessionControls,
  type LabSearch,
  type RequestCheck,
  type Session,
  type SiteResearch,
  type WalkthroughReport,
} from "./model";
import { RequestCheckView, RequestCheckInspector } from "./request-check";
import { SiteResearchView, SiteResearchInspector } from "./site-research";
import { WalkthroughUpdateView, WalkthroughUpdateInspector } from "./walkthrough-update";
import { Transcript } from "./transcript";
import { PendingTaskMessage } from "./pending-message";
import { BrowserPanel } from "./browser";
import { SessionCost } from "#components/session-cost";
import { ScoutWorkspace } from "#components/scout-workspace";
import { TaskWalkthrough } from "#components/task-walkthrough";
import type { WorkspaceTarget } from "../../convex/workspaceModel";
import {
  agentsApiPauseLabel,
  defaultTaskSelection,
  taskEngineDisabledReason,
  taskModelOptions,
  type TaskSelection,
} from "../../shared/taskModels";

const runtimeLabels: Record<Session["engine"], string> = {
  agents_api: "Agents API",
  convex_agent: "Convex Agent",
};

type RequestState = { kind: "idle" } | { kind: "pending" } | { kind: "failed"; message: string };

export function LabPage({ search }: { search: LabSearch }) {
  return (
    <main className="flex h-[calc(100dvh-4rem)] min-h-0 w-full flex-col select-text">
      <LabWorkspace search={search} />
    </main>
  );
}

function LabWorkspace({ search }: { search: LabSearch }) {
  const session = useQuery(
    api.tasks.sessions.get,
    // @ts-expect-error The server validates this URL string with v.id("agentsApiSessions"); downstream calls use the returned typed _id.
    search.session === undefined
      ? "skip"
      : {
          sessionId: search.session,
        },
  );
  const checking = Boolean(session && selectedStep(session, search) === "request_check");
  const researching = Boolean(session && selectedStep(session, search) === "site_research");
  const updatingWalkthrough = search.step === "walkthrough_update";
  const reports = useQuery(
    api.tasks.walkthroughReports.list,
    session ? { sessionId: session._id } : "skip",
  );
  const callId = updatingWalkthrough ? (search.call ?? reports?.at(-1)?.callId) : undefined;
  const report = useQuery(
    api.tasks.walkthroughReports.inspect,
    session && callId !== undefined ? { sessionId: session._id, callId } : "skip",
  );
  const research = useQuery(
    api.tasks.siteResearchRecords.inspect,
    session && researching ? { sessionId: session._id } : "skip",
  );
  const checkId = session && checking ? selectedCheckId(session, search) : undefined;
  const check = useQuery(
    api.tasks.requestChecks.inspect,
    // @ts-expect-error The server validates the URL check ID and its session membership; the inspected document supplies typed IDs.
    session && checkId !== undefined ? { sessionId: session._id, checkId } : "skip",
  );
  const {
    results: sessions,
    status,
    loadMore,
  } = usePaginatedQuery(api.tasks.sessions.list, {}, { initialNumItems: 50 });
  const sidebarSessions =
    session && !sessions.some((item) => item._id === session._id)
      ? [...sessions, session]
      : sessions;

  return (
    <SidebarLayout
      addressChrome={<LabChrome session={session ?? null} search={search} />}
      resizeHandleLabels={{
        left: "Resize tasks",
        right:
          checking || researching || updatingWalkthrough ? "Resize call details" : "Resize browser",
      }}
      formatResizeHandleValueText={({ widthPx }) => `${widthPx} pixels wide`}
      left={
        <PaneFrame
          scrollRestorationId="lab-sessions"
          content={
            <aside aria-label="Tasks" aria-busy={status === "LoadingFirstPage"}>
              {sidebarSessions.length === 0 ? (
                status === "LoadingFirstPage" ? null : (
                  <p className="p-4 text-sm text-muted-foreground">No tasks yet.</p>
                )
              ) : (
                <nav className="flex flex-col gap-1 p-2" aria-label="Tasks">
                  {sidebarSessions.map((item) => (
                    <div key={item._id} className="pb-2">
                      <Link
                        to="/lab"
                        resetScroll={false}
                        search={{
                          session: item._id,
                          sessions: search.sessions,
                          inspector: search.inspector,
                        }}
                        className="block rounded-lg px-3 py-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="block truncate font-medium">{item.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.scoutName}
                        </span>
                      </Link>
                      <ul className="ml-5 space-y-0.5 border-l pl-2 text-sm">
                        {item.checks.map((itemCheck) => (
                          <li key={itemCheck._id}>
                            <Link
                              to="/lab"
                              resetScroll={false}
                              search={{
                                session: item._id,
                                step: "request_check",
                                check: itemCheck._id,
                                sessions: search.sessions,
                                inspector: search.inspector,
                              }}
                              aria-current={
                                search.session === item._id && checking && checkId === itemCheck._id
                                  ? "page"
                                  : undefined
                              }
                              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
                            >
                              {itemCheck.status === "pending" || itemCheck.status === "running" ? (
                                <LoaderCircleIcon
                                  className="size-3.5 animate-spin"
                                  aria-hidden="true"
                                />
                              ) : itemCheck.status === "approved" ? (
                                <CheckIcon className="size-3.5" aria-hidden="true" />
                              ) : (
                                <XIcon className="size-3.5" aria-hidden="true" />
                              )}
                              {itemCheck.kind === "initial" ? "Request check" : "Resume check"}
                              <span className="sr-only"> · {itemCheck.status}</span>
                            </Link>
                          </li>
                        ))}
                        {search.session === item._id &&
                          reports?.map((call) => (
                            <li key={call.callId}>
                              <Link
                                to="/lab"
                                resetScroll={false}
                                search={{
                                  session: item._id,
                                  step: "walkthrough_update",
                                  call: call.callId,
                                  sessions: search.sessions,
                                  inspector: search.inspector,
                                }}
                                aria-current={
                                  updatingWalkthrough && callId === call.callId ? "page" : undefined
                                }
                                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
                              >
                                {call.state === "running" ? (
                                  <LoaderCircleIcon
                                    className="size-3.5 animate-spin"
                                    aria-hidden="true"
                                  />
                                ) : call.state === "completed" ? (
                                  <CheckIcon className="size-3.5" aria-hidden="true" />
                                ) : (
                                  <XIcon className="size-3.5" aria-hidden="true" />
                                )}
                                <span>
                                  Walkthrough update
                                  <time
                                    className="block text-xs"
                                    dateTime={new Date(call.startedAt).toISOString()}
                                  >
                                    {new Date(call.startedAt).toLocaleString()}
                                  </time>
                                </span>
                                <span className="sr-only"> · {call.state}</span>
                              </Link>
                            </li>
                          ))}
                        {item.research && (
                          <li>
                            <Link
                              to="/lab"
                              resetScroll={false}
                              search={{
                                session: item._id,
                                step: "site_research",
                                sessions: search.sessions,
                                inspector: search.inspector,
                              }}
                              aria-current={
                                search.session === item._id && researching ? "page" : undefined
                              }
                              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
                            >
                              {item.research.status === "running" ||
                              item.research.status === "waiting" ? (
                                <LoaderCircleIcon
                                  className="size-3.5 animate-spin"
                                  aria-hidden="true"
                                />
                              ) : (
                                <SearchIcon className="size-3.5" aria-hidden="true" />
                              )}
                              Site research
                              <span className="sr-only"> · {item.research.status}</span>
                            </Link>
                          </li>
                        )}
                        {(item.hasChat || item.checks.length === 0) && (
                          <li>
                            <Link
                              to="/lab"
                              resetScroll={false}
                              search={{
                                session: item._id,
                                step: "chat",
                                sessions: search.sessions,
                                inspector: search.inspector,
                              }}
                              aria-current={
                                search.session === item._id &&
                                session &&
                                selectedStep(session, search) === "chat"
                                  ? "page"
                                  : undefined
                              }
                              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
                            >
                              <MessageSquareIcon className="size-3.5" aria-hidden="true" />
                              Chat
                            </Link>
                          </li>
                        )}
                        <li>
                          <Link
                            to="/lab"
                            resetScroll={false}
                            search={{
                              session: item._id,
                              step: "walkthrough",
                              sessions: search.sessions,
                              inspector: search.inspector,
                            }}
                            aria-current={
                              search.session === item._id && search.step === "walkthrough"
                                ? "page"
                                : undefined
                            }
                            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
                          >
                            <ImagesIcon className="size-3.5" aria-hidden="true" />
                            Walkthrough
                          </Link>
                        </li>
                      </ul>
                    </div>
                  ))}
                  {(status === "CanLoadMore" || status === "LoadingMore") && (
                    <Button
                      variant="ghost"
                      disabled={status === "LoadingMore"}
                      onClick={() => loadMore(50)}
                    >
                      Load more tasks
                    </Button>
                  )}
                </nav>
              )}
            </aside>
          }
        />
      }
      main={
        search.session === undefined ? (
          <PaneFrame
            content={<NewSession key={search.scout} initialScoutId={search.scout ?? ""} />}
          />
        ) : session === undefined ? (
          <PaneFrame
            content={
              <p role="status" className="p-6 text-sm text-muted-foreground">
                Opening task…
              </p>
            }
          />
        ) : session === null ? (
          <PaneFrame
            content={<p className="p-6 text-sm text-muted-foreground">Task not found.</p>}
          />
        ) : (
          <SessionContent
            key={session._id}
            session={session}
            search={search}
            check={checkId === undefined ? null : check}
            research={research}
            report={callId === undefined && reports !== undefined ? null : report}
          />
        )
      }
      {...omitNullish({
        right:
          search.session === undefined ? undefined : session ? (
            updatingWalkthrough ? (
              <WalkthroughUpdateInspector key={callId} report={report} />
            ) : checking ? (
              <RequestCheckInspector key={checkId} check={check} />
            ) : researching ? (
              <SiteResearchInspector research={research} sessionId={session._id} />
            ) : (
              <BrowserPanel key={session._id} sessionId={session._id} search={search} />
            )
          ) : (
            <PaneFrame content={null} />
          ),
      })}
    />
  );
}

function LabChrome({ session, search }: { session: Session | null; search: LabSearch }) {
  const step = session && selectedStep(session, search);
  const review = useQuery(api.scout.activity.get, session ? { threadId: session._id } : "skip");
  const checking =
    step === "request_check" || step === "site_research" || step === "walkthrough_update";
  const navigate = useNavigate({ from: "/lab" });
  const { setMobilePane, toggleLeftPane, toggleRightPane } = useSidebarActions();
  const { isMobile, mobilePane, leftDesktopOpen, rightDesktopOpen } =
    useSidebarLayoutPresentation();
  const navigationShown = isMobile ? mobilePane === "left" : leftDesktopOpen;
  const browserShown = isMobile ? mobilePane === "right" : rightDesktopOpen;

  return (
    <div className="flex h-12 min-w-0 items-center gap-2 px-2 sm:px-4">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={navigationShown ? "Hide tasks" : "Show tasks"}
        aria-pressed={navigationShown}
        onClick={() =>
          isMobile ? setMobilePane(navigationShown ? "main" : "left") : toggleLeftPane()
        }
      >
        <PanelLeftIcon aria-hidden="true" />
      </Button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold" title={session?.title}>
          {session?.title ?? "Tasks"}
        </h1>
        {session && (
          <p className="truncate text-xs text-muted-foreground">
            {session.scoutName} · {runtimeLabels[session.engine]}
          </p>
        )}
      </div>
      {review?.purpose.kind === "review" && (
        <Button asChild variant="ghost" size="sm">
          <Link
            to="/tasks/$thread"
            params={{ thread: review.threadId }}
            search={{
              scope: review.visibility === "public" ? "public" : "mine",
              view: step === "walkthrough" ? "walkthrough" : "chat",
            }}
            aria-label="Open review"
          >
            <span className="hidden sm:inline">Open review</span>
            <ArrowUpRightIcon aria-hidden="true" />
          </Link>
        </Button>
      )}
      {review?.purpose.kind === "play" && (
        <Button asChild variant="ghost" size="sm">
          <Link to="/play" search={{ thread: review.threadId }} aria-label="Open play">
            <span className="hidden sm:inline">Open play</span>
            <ArrowUpRightIcon aria-hidden="true" />
          </Link>
        </Button>
      )}
      {session && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={search.view === "workspace"}
          onClick={() =>
            void navigate({
              search: {
                ...search,
                view: search.view === "workspace" ? "conversation" : "workspace",
              },
            })
          }
        >
          <FolderIcon aria-hidden="true" />
          Workspace
        </Button>
      )}
      {session && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={
            checking
              ? browserShown
                ? "Hide call details"
                : "Show call details"
              : browserShown
                ? "Hide browser"
                : "Show browser"
          }
          aria-pressed={browserShown}
          onClick={() =>
            isMobile ? setMobilePane(browserShown ? "main" : "right") : toggleRightPane()
          }
        >
          <PanelRightIcon aria-hidden="true" />
        </Button>
      )}
      <Button asChild variant="ghost" size="sm">
        <Link to="/lab" search={{}} resetScroll={false}>
          <PlusIcon aria-hidden="true" />
          New task
        </Link>
      </Button>
    </div>
  );
}

function NewSession({ initialScoutId }: { initialScoutId: string }) {
  const scouts = useQuery(api.scout.scouts.list, {});
  const start = useMutation(api.tasks.sessions.start);
  const agentsApiAvailable = useQuery(api.tasks.engineSettings.get, {}) === true;
  const navigate = useNavigate({ from: "/lab" });
  const [scoutId, setScoutId] = useState(initialScoutId);
  const [selection, setSelection] = useState<TaskSelection>(defaultTaskSelection);
  const availableSelection =
    selection.engine === "agents_api" && !agentsApiAvailable ? defaultTaskSelection : selection;
  const [prompt, setPrompt] = useState("");
  const [request, setRequest] = useState<RequestState>({ kind: "idle" });
  const submitting = useRef(false);
  const activeScouts = scouts
    ?.filter((scout) => scout.status === "active")
    .toSorted(
      (left, right) =>
        left.displayName.localeCompare(right.displayName) || left._id.localeCompare(right._id),
    );
  const selectedScout =
    activeScouts?.find((scout) => scout._id === scoutId) ??
    (scoutId === ""
      ? activeScouts?.find((scout) => scout.availability === "available")
      : undefined);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !selectedScout ||
      selectedScout.availability !== "available" ||
      !prompt.trim() ||
      submitting.current
    )
      return;
    submitting.current = true;
    setRequest({ kind: "pending" });
    try {
      const sessionId = await start({
        scoutId: selectedScout._id,
        prompt: prompt.trim(),
        selection: availableSelection,
      });
      await navigate({ search: { session: sessionId } });
    } catch (error) {
      setRequest({
        kind: "failed",
        message: error instanceof Error ? error.message : "Could not start task.",
      });
    } finally {
      submitting.current = false;
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col justify-center px-4 py-10 sm:px-8">
      <h2 className="mb-6 text-2xl font-semibold tracking-tight">New task</h2>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="lab-scout" className="text-sm font-medium">
            Scout
          </label>
          <select
            id="lab-scout"
            value={selectedScout?._id ?? ""}
            onChange={(event) => setScoutId(event.target.value)}
            disabled={request.kind === "pending" || !activeScouts?.length}
            className="block h-11 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/25 disabled:opacity-50"
          >
            {!selectedScout && (
              <option value="">{scouts === undefined ? "" : "Select a scout"}</option>
            )}
            {activeScouts?.map((scout) => (
              <option
                key={scout._id}
                value={scout._id}
                disabled={scout.availability !== "available"}
              >
                {scout.displayName}
                {scout.availability !== "available"
                  ? ` · ${scoutAvailabilityLabels[scout.availability]}`
                  : ""}
              </option>
            ))}
          </select>
          {scouts !== undefined && activeScouts?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No active scouts.{" "}
              <Link to="/scouts" className="underline">
                Manage scouts
              </Link>
            </p>
          )}
        </div>
        <div className="space-y-2">
          <label htmlFor="task-runtime" className="text-sm font-medium">
            Model
          </label>
          <select
            id="task-runtime"
            aria-describedby="task-runtime-description"
            value={
              availableSelection.model === "gpt-5.6-luna"
                ? availableSelection.engine
                : availableSelection.model
            }
            disabled={request.kind === "pending"}
            onChange={(event) => {
              const option = taskModelOptions.find((option) => option.value === event.target.value);
              if (option && !taskEngineDisabledReason(option.selection.engine, agentsApiAvailable))
                setSelection(option.selection);
            }}
            className="block h-11 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/25 disabled:opacity-50"
          >
            {taskModelOptions.map((option) => {
              const disabled =
                taskEngineDisabledReason(option.selection.engine, agentsApiAvailable) !== null;
              return (
                <option key={option.value} value={option.value} disabled={disabled}>
                  {option.label}
                  {disabled ? ` (${agentsApiPauseLabel})` : ""}
                </option>
              );
            })}
          </select>
          <p id="task-runtime-description" className="text-xs text-muted-foreground">
            {availableSelection.engine === "agents_api"
              ? "OpenAI manages conversation context and includes native web search."
              : "Scout manages conversation summaries and keeps only the latest browser snapshot. Native web search is unavailable."}
          </p>
        </div>
        <label htmlFor="lab-prompt" className="sr-only">
          Prompt
        </label>
        <Textarea
          id="lab-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="What should Scout do?"
          maxLength={20_000}
          disabled={request.kind === "pending"}
          className="min-h-36"
        />
        {request.kind === "failed" && (
          <p role="alert" className="text-sm wrap-anywhere text-destructive">
            {request.message}
          </p>
        )}
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={
              !selectedScout ||
              selectedScout.availability !== "available" ||
              !prompt.trim() ||
              request.kind === "pending"
            }
          >
            {request.kind === "pending" ? "Starting…" : "Start"}
          </Button>
        </div>
      </form>
    </section>
  );
}

function SessionContent({
  session,
  search,
  check,
  research,
  report,
}: {
  session: Session;
  search: LabSearch;
  check: RequestCheck | null | undefined;
  research: SiteResearch | null | undefined;
  report: WalkthroughReport | null | undefined;
}) {
  const checking = selectedStep(session, search) === "request_check";
  const researching = selectedStep(session, search) === "site_research";
  const updatingWalkthrough = selectedStep(session, search) === "walkthrough_update";
  const navigate = useNavigate({ from: "/lab" });
  const target = useMemo(
    () => ({ kind: "agent_session", sessionId: session._id }) satisfies WorkspaceTarget,
    [session._id],
  );
  return (
    <div className="h-full min-h-0">
      <div
        hidden={checking || researching || updatingWalkthrough || search.view === "workspace"}
        className="h-full min-h-0"
      >
        {(session.hasChat || session.checks.length === 0 || search.step === "walkthrough") && (
          <SessionView
            session={session}
            walkthrough={search.step === "walkthrough" && search.view !== "workspace"}
          />
        )}
      </div>
      {checking && search.view !== "workspace" && (
        <RequestCheckView key={selectedCheckId(session, search)} session={session} check={check} />
      )}
      {researching && search.view !== "workspace" && (
        <SiteResearchView session={session} research={research} />
      )}
      {updatingWalkthrough && search.view !== "workspace" && (
        <WalkthroughUpdateView key={search.call} report={report} />
      )}
      {search.view === "workspace" && (
        <ScoutWorkspace
          target={target}
          disabled
          selectedPath={
            search.file ?? (research?.state.kind === "completed" ? research.state.briefPath : null)
          }
          onSelectPath={(file) => void navigate({ search: { ...search, file } })}
          terminalOpen={false}
          onToggleTerminal={() => {}}
        />
      )}
    </div>
  );
}

function SessionView({ session, walkthrough }: { session: Session; walkthrough: boolean }) {
  const send = useMutation(api.tasks.sessions.send);
  const retryMessage = useMutation(api.tasks.sessions.retryMessage);
  const stop = useMutation(api.tasks.sessions.stop);
  const resume = useMutation(api.tasks.sessions.resume);
  const decline = useMutation(api.tasks.sessions.declineHandoff);
  const refresh = useAction(api.tasks.runtime.refresh);
  const [draft, setDraft] = useState("");
  const [request, setRequest] = useState<RequestState>({ kind: "idle" });
  const submitting = useRef(false);
  const controls = sessionControls(session.state);
  const canSend =
    session.canControl &&
    controls.canSend &&
    !session.active &&
    session.hasChat &&
    Boolean(draft.trim());
  const canStop = controls.canStop || session.active;
  const error =
    session.cleanupError ?? (session.state.kind === "failed" ? session.state.error : null);
  const errorMessage =
    (!session.cleanupError && session.state.kind === "failed"
      ? session.state.diagnostic?.message
      : undefined) ?? error?.split(/\r?\n/, 1)[0];
  const pending = request.kind === "pending";

  async function run(operation: "send" | "retry" | "stop" | "resume" | "decline" | "refresh") {
    if (
      submitting.current ||
      (operation !== "refresh" && operation !== "stop" && !session.canControl)
    )
      return;
    if (operation === "send" && !canSend) return;
    if (operation === "refresh" && session.active) return;
    submitting.current = true;
    setRequest({ kind: "pending" });
    try {
      switch (operation) {
        case "retry":
          await retryMessage({ sessionId: session._id });
          break;
        case "send":
          await send({ sessionId: session._id, message: draft.trim() });
          setDraft("");
          break;
        case "stop":
          await stop({ sessionId: session._id });
          break;
        case "resume":
        case "decline":
          if (session.state.kind !== "waiting") break;
          await (operation === "resume" ? resume : decline)({
            sessionId: session._id,
            callId: session.state.callId,
            turnId: session.state.turnId,
          });
          break;
        case "refresh":
          await refresh({ sessionId: session._id });
          break;
      }
      setRequest({ kind: "idle" });
    } catch (error) {
      setRequest({
        kind: "failed",
        message:
          error instanceof ConvexError && typeof error.data === "string"
            ? error.data
            : error instanceof Error
              ? error.message
              : String(error),
      });
    } finally {
      submitting.current = false;
    }
  }

  return (
    <section
      aria-label={walkthrough ? "Walkthrough and task controls" : "Conversation"}
      className="flex h-full min-h-0 min-w-0 flex-col"
    >
      <div hidden={walkthrough} className="flex min-h-0 flex-1 flex-col">
        <Transcript sessionId={session._id} />
      </div>
      {walkthrough && (
        <div className="min-h-0 flex-1">
          <TaskWalkthrough sessionId={session._id} />
        </div>
      )}
      <div className="shrink-0 space-y-3 border-t p-4">
        <PendingTaskMessage
          pendingMessage={session.pendingMessage}
          active={
            session.active && session.state.kind !== "failed" && session.state.kind !== "stopped"
          }
          canRetry={session.canControl && !session.active && session.hasChat}
          retrying={pending}
          onRetry={() => void run("retry")}
        />
        <div className="flex items-start justify-between gap-3">
          {!walkthrough && <SessionCost session={session} />}
          {!session.active && (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Refresh task"
              disabled={pending}
              onClick={() => void run("refresh")}
            >
              <RotateCcwIcon aria-hidden="true" /> Refresh
            </Button>
          )}
          {canStop && (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => void run("stop")}>
              <SquareIcon aria-hidden="true" /> {session.cleanupError ? "Retry stop" : "Stop"}
            </Button>
          )}
        </div>
        {session.state.kind === "waiting" && (
          <div className="space-y-3">
            <p className="text-sm whitespace-pre-wrap wrap-anywhere">{session.state.message}</p>
            {session.state.expiresAt !== undefined && (
              <p className="text-sm">
                {handoffDeadlineMessage(
                  session.state.expiresAt,
                  undefined,
                  session.state.openedAt === undefined ? "open" : "resume",
                )}
              </p>
            )}
            {session.checkMessage && (
              <p
                role="alert"
                className="text-sm whitespace-pre-wrap wrap-anywhere text-destructive"
              >
                {session.checkMessage}
              </p>
            )}
            {session.canControl && (
              <div className="flex flex-wrap gap-2">
                <Button disabled={pending} onClick={() => void run("resume")}>
                  Resume
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => void run("decline")}>
                  I couldn't complete this
                </Button>
              </div>
            )}
          </div>
        )}
        {session.state.kind === "checking" && (
          <p role="status" className="text-sm text-muted-foreground">
            Checking browser…
          </p>
        )}
        {error && (
          <div className="space-y-2">
            <p role="alert" className="text-sm whitespace-pre-wrap wrap-anywhere text-destructive">
              {errorMessage}
            </p>
            {session.state.kind === "failed" && session.state.diagnostic && (
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Failure details
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto text-xs whitespace-pre-wrap wrap-anywhere select-text">
                  {JSON.stringify(
                    {
                      taskId: session._id,
                      providerSessionId: session.providerId,
                      ...session.state.diagnostic,
                      error: session.state.error,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            )}
            {error.trimEnd().includes("\n") &&
              (session.cleanupError ||
                session.state.kind !== "failed" ||
                !session.state.diagnostic) && (
                <details>
                  <summary className="w-fit cursor-pointer rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                    Details
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap wrap-anywhere select-text">
                    {error}
                  </pre>
                </details>
              )}
          </div>
        )}
        {session.state.kind === "stopped" && (session.state.reason !== undefined || !error) && (
          <p className="text-sm text-muted-foreground">
            {session.state.reason === "handoff_expired"
              ? HANDOFF_EXPIRED_REASON
              : session.state.reason === "handoff_declined"
                ? HANDOFF_DECLINED_REASON
                : session.active
                  ? "Stopping…"
                  : "Stopped"}
          </p>
        )}
        {request.kind === "failed" && (
          <p role="alert" className="text-sm wrap-anywhere text-destructive">
            {request.message}
          </p>
        )}
        {session.canControl && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run("send");
            }}
            className="flex items-end gap-2"
          >
            <Textarea
              aria-label="Message"
              placeholder="Message Scout…"
              maxLength={20_000}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={pending}
              className={
                walkthrough ? "max-h-32 min-h-12 resize-none" : "max-h-48 min-h-20 resize-none"
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void run("send");
                }
              }}
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Send message"
              disabled={!canSend || pending}
            >
              <SendIcon aria-hidden="true" />
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}

export function LabError({ error, reset }: ErrorComponentProps) {
  return (
    <main className="route-page max-w-2xl select-text">
      <h1 className="text-xl font-semibold">Could not open Lab</h1>
      <p role="alert" className="my-4 text-sm wrap-anywhere text-destructive">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <div className="flex gap-3">
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
        <Button asChild variant="ghost">
          <Link to="/lab" search={{}}>
            New task
          </Link>
        </Button>
      </div>
    </main>
  );
}

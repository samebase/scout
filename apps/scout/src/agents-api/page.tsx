import { PaneFrame } from "@samebase/sidebars/PaneFrame";
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
} from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { api } from "../../convex/_generated/api";
import { scoutAvailabilityLabels } from "#components/scout-current-activity";
import { omitNullish } from "../../shared/omitNullish";
import { Button } from "#components/ui/button";
import { Textarea } from "#components/ui/textarea";
import {
  selectedCheckId,
  selectedStep,
  sessionControls,
  type AgentsSearch,
  type RequestCheck,
  type Session,
  type SiteResearch,
} from "./model";
import { RequestCheckView, RequestCheckInspector } from "./request-check";
import { SiteResearchView, SiteResearchInspector } from "./site-research";
import { Transcript } from "./transcript";
import { BrowserPanel } from "./browser";
import { SessionCost } from "./cost";
import { ScoutWorkspace } from "#components/scout-workspace";
import { TaskWalkthrough } from "#components/task-walkthrough";
import type { WorkspaceTarget } from "../../convex/workspaceModel";

type RequestState = { kind: "idle" } | { kind: "pending" } | { kind: "failed"; message: string };

export function AgentsPage({ search }: { search: AgentsSearch }) {
  return (
    <main className="flex h-[calc(100dvh-4rem)] min-h-0 w-full flex-col select-text">
      <AgentsWorkspace search={search} />
    </main>
  );
}

function AgentsWorkspace({ search }: { search: AgentsSearch }) {
  const session = useQuery(
    api.agentsApi.sessions.get,
    // @ts-expect-error The server validates this URL string with v.id("agentsApiSessions"); downstream calls use the returned typed _id.
    search.session === undefined
      ? "skip"
      : {
          sessionId: search.session,
        },
  );
  const checking = Boolean(session && selectedStep(session, search) === "request_check");
  const researching = Boolean(session && selectedStep(session, search) === "site_research");
  const research = useQuery(
    api.agentsApi.siteResearchRecords.inspect,
    session && researching ? { sessionId: session._id } : "skip",
  );
  const checkId = session && checking ? selectedCheckId(session, search) : undefined;
  const check = useQuery(
    api.agentsApi.requestChecks.inspect,
    // @ts-expect-error The server validates the URL check ID and its session membership; the inspected document supplies typed IDs.
    session && checkId !== undefined ? { sessionId: session._id, checkId } : "skip",
  );
  const {
    results: sessions,
    status,
    loadMore,
  } = usePaginatedQuery(api.agentsApi.sessions.list, {}, { initialNumItems: 50 });

  return (
    <SidebarLayout
      addressChrome={<AgentsChrome session={session ?? null} search={search} />}
      resizeHandleLabels={{
        left: "Resize tasks",
        right: checking || researching ? "Resize call details" : "Resize browser",
      }}
      formatResizeHandleValueText={({ widthPx }) => `${widthPx} pixels wide`}
      left={
        <PaneFrame
          scrollRestorationId="agents-sessions"
          content={
            <aside aria-label="Tasks">
              {status === "LoadingFirstPage" ? (
                <p role="status" className="p-4 text-sm text-muted-foreground">
                  Loading tasks…
                </p>
              ) : sessions.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No tasks yet.</p>
              ) : (
                <nav className="flex flex-col gap-1 p-2" aria-label="Tasks">
                  {sessions.map((item) => (
                    <div key={item._id} className="pb-2">
                      <Link
                        to="/agents"
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
                              to="/agents"
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
                        {item.research && (
                          <li>
                            <Link
                              to="/agents"
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
                              {item.research.status === "running" ? (
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
                              to="/agents"
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
                            to="/agents"
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
                      {status === "LoadingMore" ? "Loading…" : "Load more tasks"}
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
          <PaneFrame content={<NewSession />} />
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
          />
        )
      }
      {...omitNullish({
        right:
          search.session === undefined ? undefined : session ? (
            checking ? (
              <RequestCheckInspector key={checkId} check={check} />
            ) : researching ? (
              <SiteResearchInspector research={research} />
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

function AgentsChrome({ session, search }: { session: Session | null; search: AgentsSearch }) {
  const step = session && selectedStep(session, search);
  const checking = step === "request_check" || step === "site_research";
  const navigate = useNavigate({ from: "/agents" });
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
        {session && <p className="truncate text-xs text-muted-foreground">{session.scoutName}</p>}
      </div>
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
        <Link to="/agents" search={{}} resetScroll={false}>
          <PlusIcon aria-hidden="true" />
          New task
        </Link>
      </Button>
    </div>
  );
}

function NewSession() {
  const scouts = useQuery(api.scout.scouts.list, {});
  const start = useMutation(api.agentsApi.sessions.start);
  const navigate = useNavigate({ from: "/agents" });
  const [scoutId, setScoutId] = useState("");
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
      const sessionId = await start({ scoutId: selectedScout._id, prompt: prompt.trim() });
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
          <label htmlFor="agents-scout" className="text-sm font-medium">
            Scout
          </label>
          <select
            id="agents-scout"
            value={selectedScout?._id ?? ""}
            onChange={(event) => setScoutId(event.target.value)}
            disabled={request.kind === "pending" || !activeScouts?.length}
            className="block h-11 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/25 disabled:opacity-50"
          >
            {!selectedScout && (
              <option value="">
                {scouts === undefined ? "Loading scouts…" : "Select a scout"}
              </option>
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
        <label htmlFor="agents-prompt" className="sr-only">
          Prompt
        </label>
        <Textarea
          id="agents-prompt"
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
}: {
  session: Session;
  search: AgentsSearch;
  check: RequestCheck | null | undefined;
  research: SiteResearch | null | undefined;
}) {
  const checking = selectedStep(session, search) === "request_check";
  const researching = selectedStep(session, search) === "site_research";
  const navigate = useNavigate({ from: "/agents" });
  const target = useMemo<WorkspaceTarget>(
    () => ({ kind: "agent_session", sessionId: session._id }),
    [session._id],
  );
  return (
    <div className="h-full min-h-0">
      <div
        hidden={checking || researching || search.view === "workspace"}
        className="h-full min-h-0"
      >
        {(session.providerId || session.checks.length === 0 || search.step === "walkthrough") && (
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
  const send = useMutation(api.agentsApi.sessions.send);
  const stop = useMutation(api.agentsApi.sessions.stop);
  const resume = useMutation(api.agentsApi.sessions.resume);
  const refresh = useAction(api.agentsApi.runtime.refresh);
  const [draft, setDraft] = useState("");
  const [request, setRequest] = useState<RequestState>({ kind: "idle" });
  const submitting = useRef(false);
  const controls = sessionControls(session.state);
  const canSend =
    session.canControl &&
    controls.canSend &&
    !session.active &&
    Boolean(session.providerId) &&
    Boolean(draft.trim());
  const canStop = session.canControl && (controls.canStop || session.active);
  const error =
    session.cleanupError ?? (session.state.kind === "failed" ? session.state.error : null);
  const pending = request.kind === "pending";

  async function run(operation: "send" | "stop" | "resume" | "refresh") {
    if (submitting.current || (operation !== "refresh" && !session.canControl)) return;
    if (operation === "send" && !canSend) return;
    if (operation === "refresh" && session.active) return;
    submitting.current = true;
    setRequest({ kind: "pending" });
    try {
      switch (operation) {
        case "send":
          await send({ sessionId: session._id, message: draft.trim() });
          setDraft("");
          break;
        case "stop":
          await stop({ sessionId: session._id });
          break;
        case "resume":
          if (session.state.kind !== "waiting") break;
          await resume({
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
        message: error instanceof Error ? error.message : `Could not ${operation} task.`,
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
        <div className="flex items-start justify-between gap-3">
          <SessionCost session={session} />
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
            {session.checkMessage && (
              <p
                role="alert"
                className="text-sm whitespace-pre-wrap wrap-anywhere text-destructive"
              >
                {session.checkMessage}
              </p>
            )}
            {session.canControl && (
              <Button disabled={pending} onClick={() => void run("resume")}>
                Resume
              </Button>
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
            <p role="alert" className="text-sm wrap-anywhere text-destructive">
              {error.split(/\r?\n/, 1)[0]}
            </p>
            {error.trimEnd().includes("\n") && (
              <details>
                <summary className="w-fit cursor-pointer rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                  Details
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap wrap-anywhere">
                  {error}
                </pre>
              </details>
            )}
          </div>
        )}
        {session.state.kind === "stopped" && !error && (
          <p className="text-sm text-muted-foreground">
            {session.active ? "Stopping…" : "Stopped"}
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

export function AgentsError({ error, reset }: ErrorComponentProps) {
  return (
    <main className="route-page max-w-2xl select-text">
      <h1 className="text-xl font-semibold">Could not open Agents</h1>
      <p role="alert" className="my-4 text-sm wrap-anywhere text-destructive">
        {error.message}
      </p>
      <div className="flex gap-3">
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
        <Button asChild variant="ghost">
          <Link to="/agents" search={{}}>
            New task
          </Link>
        </Button>
      </div>
    </main>
  );
}

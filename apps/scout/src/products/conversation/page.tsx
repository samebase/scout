import { z } from "zod";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#components/ui/select";
import { accountAccessMessage, canAccess, useViewerAccess } from "../../lib/access";
import { useSidebarActions } from "@samebase/sidebars/SidebarRuntime";
import { Link, useNavigate } from "@tanstack/react-router";
import { useConvexAuth, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  LoaderCircleIcon,
  MonitorIcon,
} from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { scoutAvailabilityLabels } from "#components/scout-current-activity";
import { productRoutes, type ProductKind, type ConversationSearch } from "./model";
import { gameInviteDisplayText } from "../play/invite";
import { ConversationComposer } from "./composer";
import {
  ConversationSidebar,
  ConversationLayout,
  BrowserToggle,
  BrowserStop,
  TasksToggle,
} from "./sidebar";
import { TaskNavigation } from "./task-navigation";
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from "../../components/ui/message-scroller";
import { AuthPanel } from "../../components/auth-panel";
import { BrowserReplay } from "../../components/browser-replay";
import { TaskWalkthrough } from "#components/task-walkthrough";
import { Button } from "#components/ui/button";
import { ChatHandoffNotice } from "../../components/chat-handoff-notice";
import { ProductShell } from "../shell";
import { ScoutPiece } from "../play/scout-piece";
import { cn } from "#lib/utils";
import { productButtonVariants } from "../ui";
import { playError, playLoading, playNotice, playRouteMessage, playTextLink } from "./ui";

type ChatThread = NonNullable<FunctionReturnType<typeof api.scout.activity.get>>;
type Activity = FunctionReturnType<typeof api.scout.chats.getScoutActivity>;
type ThreadActivity = Extract<Activity, { threadId: string }>;
const visibilitySchema = z.enum(["public", "private"]);
type RequestState = { kind: "idle" } | { kind: "pending" } | { kind: "failed"; message: string };

export function ConversationError() {
  return (
    <ProductShell product={null}>
      <main id="main-content" className={playRouteMessage}>
        <h1 className="text-[30px]">Couldn't open this session</h1>
        <p className="text-muted-foreground">
          The link may be unavailable, or the connection was interrupted.
        </p>
        <Link to="/" className={productButtonVariants({ variant: "play" })}>
          Back to activity
        </Link>
      </main>
    </ProductShell>
  );
}

export function ConversationPage({
  kind,
  search,
}: {
  kind: ProductKind;
  search: ConversationSearch;
}) {
  const { thread } = search;
  return (
    <ProductShell product={kind}>
      <main
        id="main-content"
        className={
          thread
            ? "mx-auto flex h-[calc(100dvh-4rem)] min-h-[540px] max-w-[1456px] flex-col px-1 pt-4 pb-6 max-[760px]:min-h-[460px] max-[760px]:pt-4 max-[760px]:pb-3"
            : "grid min-h-[calc(100dvh-4rem)] place-items-center px-5 pt-8 pb-[16vh] max-[760px]:pb-[12vh]"
        }
      >
        {thread ? (
          <SessionLoader threadId={thread} kind={kind} search={search} />
        ) : (
          <ConversationLobby key={kind} kind={kind} />
        )}
      </main>
    </ProductShell>
  );
}

function ConversationUnavailable({ kind }: { kind: ProductKind }) {
  const message = accountAccessMessage(useViewerAccess());
  return (
    <div className="mx-auto max-w-[420px]">
      <h1 className="text-3xl font-semibold">{message?.title ?? "Access unavailable"}</h1>
      <p className="mt-4 text-muted-foreground">
        {message?.description ?? `Sign in with an approved account to ${kind}.`}
      </p>
      <Link to="/settings" className={cn(playTextLink, "mt-6 inline-flex")}>
        Account settings
      </Link>
    </div>
  );
}

export function ConversationLobby({ kind }: { kind: ProductKind }) {
  const isPlay = kind === "play";
  const viewer = useViewerAccess();
  const canRun =
    viewer?.kind === "account" &&
    canAccess(isPlay ? "access_play" : "access_review", viewer.accessKeys);
  const { isAuthenticated, isLoading } = useConvexAuth();
  const scouts = useQuery(api.scout.activity.players);
  const startChat = useMutation(api.scout.chats.startProductChat);
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [selectedScoutId, setSelectedScoutId] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [request, setRequest] = useState<RequestState>({ kind: "idle" });
  const [visibility, setVisibility] = useState<ChatThread["visibility"]>(
    isPlay ? "private" : "public",
  );
  const submitting = useRef(false);
  const activeScouts = scouts?.filter((scout) => scout.status === "active") ?? [];
  const selectedScout =
    activeScouts.find((scout) => scout._id === selectedScoutId) ??
    activeScouts.find((scout) => !scout.busy) ??
    activeScouts[0];
  const loadingScouts = isLoading || scouts === undefined;
  const noScouts = isAuthenticated && scouts !== undefined && activeScouts.length === 0;

  async function inviteScout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const prompt = draft.trim();
    if (!prompt) return;
    if (!isAuthenticated) {
      setRequest({ kind: "idle" });
      setSigningIn(true);
      return;
    }
    if (!canRun || !selectedScout) return;
    submitting.current = true;
    setRequest({ kind: "pending" });
    try {
      const { threadId } = await startChat({
        kind,
        scoutId: selectedScout._id,
        prompt,
        visibility,
      });
      await navigate({ to: productRoutes[kind], search: { thread: threadId } });
    } catch {
      setRequest({
        kind: "failed",
        message: "Couldn't start the chat. Choose an available Scout and try again.",
      });
    } finally {
      submitting.current = false;
    }
  }

  if (isAuthenticated && viewer && !canRun) return <ConversationUnavailable kind={kind} />;

  return (
    <div className="w-full max-w-[660px]">
      <div className={cn("mb-7 flex flex-col", isPlay && "items-center text-center")}>
        {isPlay && (
          <div className="relative mb-8 flex h-[110px] w-[152px] items-center justify-center">
            <span className="absolute inset-x-0 bottom-0 h-14 -rotate-6 rounded-[50%] bg-play-sand" />
            <ScoutPiece className="-rotate-6" />
          </div>
        )}
        {!isPlay && (
          <p className="mb-3 text-base text-muted-foreground">
            Tired of reviewing hackathon submissions?
          </p>
        )}
        <h1
          className={
            isPlay
              ? "text-[52px] leading-[1.08] font-semibold tracking-[-2px] max-[760px]:text-[40px]"
              : "text-[40px] leading-[1.2] font-medium tracking-[-1px] max-[760px]:text-[32px]"
          }
        >
          {isPlay ? (
            "What are we playing?"
          ) : (
            <>
              Send a Scout instead. <span aria-hidden="true">😉</span>
            </>
          )}
        </h1>
        {isPlay && (
          <p className="mt-4 text-base text-muted-foreground">
            Bring a game, or find one together.
          </p>
        )}
        {!isPlay && (
          <p className="mt-4 max-w-[580px] text-base text-muted-foreground">
            Scout creates its own accounts, logs in, and tests the site. You get its findings,
            screenshots, and a video replay.
          </p>
        )}
      </div>
      <section aria-label={isPlay ? "Start playing" : "Start a review"}>
        {signingIn && !isAuthenticated ? (
          <div className="mx-auto max-w-[400px]">
            <button
              type="button"
              className={cn(playTextLink, "mb-6 text-muted-foreground")}
              onClick={() => setSigningIn(false)}
            >
              <ArrowLeftIcon size={15} aria-hidden="true" /> Back to your message
            </button>
            <AuthPanel />
          </div>
        ) : (
          <>
            {request.kind === "failed" && (
              <p className={playError} role="alert">
                {request.message}
              </p>
            )}
            {noScouts && (
              <div className={playNotice} role="status">
                <strong className="block">No Scout is available yet.</strong>
                {viewer?.kind === "account" &&
                  canAccess("access_scout_manage", viewer.accessKeys) && (
                    <Link
                      to="/scouts"
                      className="mt-2 inline-flex items-center gap-1 underline underline-offset-4"
                    >
                      Set up a Scout <ArrowUpRightIcon size={14} aria-hidden="true" />
                    </Link>
                  )}
              </div>
            )}
            <ConversationComposer
              value={draft}
              onChange={setDraft}
              onSubmit={(event) => {
                void inviteScout(event);
              }}
              disabled={request.kind === "pending"}
              canSend={!loadingScouts && !noScouts && !selectedScout?.busy}
              onStop={null}
              placeholder={
                isPlay
                  ? "Let's play… Paste a game link or tell me what you have in mind."
                  : "Paste a product link and describe what to review."
              }
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-1">
                {loadingScouts ? (
                  "Loading Scouts…"
                ) : request.kind === "pending" ? (
                  "Starting…"
                ) : activeScouts.length > 0 ? (
                  <div className="flex min-w-0 items-center gap-1">
                    {isPlay && <ScoutPiece size="brand" className="scale-75" />}
                    <Select value={selectedScout?._id ?? ""} onValueChange={setSelectedScoutId}>
                      <SelectTrigger
                        aria-label="Your Scout"
                        className="min-h-11 max-w-[190px] border-0 shadow-none max-[400px]:max-w-[145px]"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper" align="start">
                        {activeScouts.map((scout) => (
                          <SelectItem key={scout._id} value={scout._id} disabled={scout.busy}>
                            {scout.displayName}
                            {scout.busy ? ` · ${scoutAvailabilityLabels[scout.availability]}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : isPlay ? (
                  "Scout Play"
                ) : (
                  "Scout Review"
                )}
                <Select
                  value={visibility}
                  disabled={request.kind === "pending"}
                  onValueChange={(value) => setVisibility(visibilitySchema.parse(value))}
                >
                  <SelectTrigger
                    aria-label="Visibility"
                    className="min-h-11 shrink-0 border-0 shadow-none"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="private">Private</SelectItem>
                    <SelectItem value="public">Public</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </ConversationComposer>
            {isPlay && (
              <div className="mt-5 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
                {["Find a game for us", "Help me learn a game"].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={request.kind === "pending"}
                    onClick={() => setDraft(suggestion)}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg hover:text-primary"
                  >
                    {suggestion} <ArrowRightIcon size={14} aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function SessionLoader({
  threadId,
  kind,
  search,
}: {
  threadId: string;
  kind: ProductKind;
  search: ConversationSearch;
}) {
  const viewer = useViewerAccess();
  const thread = useQuery(api.scout.activity.get, { threadId });
  if (thread === undefined)
    return (
      <p className={playLoading} role="status">
        Opening session…
      </p>
    );
  if (thread === null || thread.purpose.kind !== kind)
    return (
      <div className={playRouteMessage}>
        <h1 className="text-[30px]">Session unavailable</h1>
        <p className="text-muted-foreground">This link is private or no longer available.</p>
        <Link to="/" className={productButtonVariants({ variant: "play" })}>
          Browse activity
        </Link>
        {viewer?.kind !== "account" && <AuthPanel />}
      </div>
    );
  const initialView =
    kind === "review" && thread.runtime.kind === "agents_api"
      ? (search.view ??
        (thread.status === "finished" && thread.hasWalkthrough ? "walkthrough" : "chat"))
      : "chat";
  return (
    <ConversationSidebar key={threadId}>
      <ConversationSession thread={thread} kind={kind} search={search} initialView={initialView} />
    </ConversationSidebar>
  );
}

function activityForThread(
  activity: Activity | undefined,
  threadId: string,
): ThreadActivity | undefined {
  if (!activity) return undefined;
  switch (activity.kind) {
    case "running":
    case "stopping":
    case "handoff":
      return activity.threadId === threadId ? activity : undefined;
    case "busy":
    case "idle":
      return undefined;
  }
}

function activityNotice(activity: Activity | undefined, threadId: string) {
  if (!activity) return "Connecting...";
  if (activity.kind === "idle") return null;
  const selectedActivity = activityForThread(activity, threadId);
  if (!selectedActivity) return "Busy in another session";
  switch (selectedActivity.kind) {
    case "running":
    case "handoff":
      return null;
    case "stopping":
      return selectedActivity.retryable ? "Couldn't stop. Try again." : "Stopping Scout...";
  }
}

function ConversationSession({
  thread,
  kind,
  search,
  initialView,
}: {
  thread: ChatThread;
  kind: ProductKind;
  search: ConversationSearch;
  initialView: "walkthrough" | "chat";
}) {
  const scout = thread.scout;
  const viewer = useViewerAccess();
  const canInspect =
    (thread.isOwner || thread.runtime.kind === "agents_api") &&
    viewer?.kind === "account" &&
    canAccess("access_lab", viewer.accessKeys);
  const navigate = useNavigate();
  const { setMobilePane } = useSidebarActions();
  const { threadId } = thread;
  const managedId = thread.runtime.kind === "agents_api" ? thread.runtime.sessionId : null;
  const [defaultView] = useState(initialView);
  const showingWalkthrough =
    kind === "review" && managedId !== null && (search.view ?? defaultView) === "walkthrough";
  const managed = useQuery(
    api.agentsApi.sessions.controls,
    thread.canControl && managedId ? { sessionId: managedId } : "skip",
  );
  const activity = useQuery(
    api.scout.chats.getScoutActivity,
    thread.canControl && !managedId ? { threadId } : "skip",
  );
  const sessions = thread.sessions;
  const latestSession = sessions?.at(-1);
  const session =
    sessions?.find((session) => session.sessionId === search.session) ?? latestSession;
  const liveView = useQuery(
    api.scout.activity.liveView,
    session && session.kind !== "closed" ? { sessionId: session.sessionId } : "skip",
  );
  const handoff = useQuery(
    api.humanHandoffs.forSession,
    thread.canControl && latestSession?.engine === "convex_agent"
      ? { sessionId: latestSession.sessionId }
      : "skip",
  );
  const messages = usePaginatedQuery(
    api.scout.activity.messages,
    { threadId },
    { initialNumItems: 50 },
  );
  const sendMessage = useMutation(api.scout.chats.sendMessage);
  const stopScout = useMutation(api.scout.chats.stop);
  const sendManaged = useMutation(api.agentsApi.sessions.send);
  const stopManaged = useMutation(api.agentsApi.sessions.stop);
  const resumeManaged = useMutation(api.agentsApi.sessions.resume);
  const setVisibility = useMutation(api.scout.chats.setVisibility);
  const [draft, setDraft] = useState("");
  const [request, setRequest] = useState<RequestState>({ kind: "idle" });
  const pending = useRef(false);
  const ownActivity = activityForThread(activity, threadId);
  const canStop = managedId
    ? managed?.canStop === true
    : ownActivity !== undefined && (ownActivity.kind !== "stopping" || ownActivity.retryable);
  const canSend =
    thread.canControl &&
    scout.status === "active" &&
    (managedId ? managed?.canSend === true : activity?.kind === "idle") &&
    request.kind !== "pending";
  const visibleMessages = messages.results.toReversed();
  const phase = thread.purpose.kind === "play" ? thread.purpose.step : null;
  const phaseLabel = phase
    ? { research: "Researching the game", account_setup: "Setting up an account", play: "Playing" }[
        phase
      ]
    : null;

  async function changeVisibility(visibility: ChatThread["visibility"]) {
    if (pending.current) return;
    pending.current = true;
    setRequest({ kind: "pending" });
    try {
      await setVisibility({ threadId, visibility });
      setRequest({ kind: "idle" });
    } catch {
      setRequest({ kind: "failed", message: "Couldn't change visibility. Try again." });
    } finally {
      pending.current = false;
    }
  }

  async function stop() {
    if (pending.current) return;
    pending.current = true;
    setRequest({ kind: "pending" });
    try {
      if (managedId) await stopManaged({ sessionId: managedId });
      else await stopScout({ threadId });
      setRequest({ kind: "idle" });
    } catch {
      setRequest({ kind: "failed", message: "Couldn't stop Scout. Try again." });
    } finally {
      pending.current = false;
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || !canSend || pending.current) return;
    pending.current = true;
    setRequest({ kind: "pending" });
    try {
      if (managedId) await sendManaged({ sessionId: managedId, message: prompt });
      else await sendMessage({ threadId, prompt });
      setDraft("");
      setRequest({ kind: "idle" });
    } catch {
      setRequest({
        kind: "failed",
        message: "Your message wasn't sent. Try again when Scout is ready.",
      });
    } finally {
      pending.current = false;
    }
  }

  async function resume() {
    if (!managedId || managed?.state.kind !== "waiting" || pending.current) return;
    pending.current = true;
    setRequest({ kind: "pending" });
    try {
      await resumeManaged({
        sessionId: managedId,
        callId: managed.state.callId,
        turnId: managed.state.turnId,
      });
      setRequest({ kind: "idle" });
    } catch {
      setRequest({ kind: "failed", message: "Couldn't resume Scout. Try again." });
    } finally {
      pending.current = false;
    }
  }

  const browserHeader = (
    <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border px-3 text-[13px]">
      <MonitorIcon size={16} className="shrink-0" aria-hidden="true" />
      {sessions && sessions.length > 1 && session ? (
        <select
          aria-label="Browser session"
          value={session.sessionId}
          onChange={(event) => {
            const selected = sessions.find(
              (session) => session.sessionId === event.currentTarget.value,
            );
            if (selected)
              void navigate({
                to: productRoutes[kind],
                search: {
                  ...search,
                  session: selected.sessionId,
                  replay: undefined,
                },
              });
          }}
          className="min-h-11 min-w-0 flex-1 rounded-lg bg-transparent pr-1 font-medium"
        >
          {sessions.toReversed().map((session) => (
            <option key={session.sessionId} value={session.sessionId}>
              {new Date(session.createdAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                second: "2-digit",
              })}
              {session.kind === "active"
                ? " · Live"
                : session.kind === "closing"
                  ? " · Closing"
                  : ""}
            </option>
          ))}
        </select>
      ) : (
        <span className="min-w-0 flex-1 font-medium">
          {session?.kind === "closed" ? "Replay" : "Scout’s view"}
        </span>
      )}
      {kind === "play" && <BrowserToggle action="close" />}
    </div>
  );

  return (
    <ConversationLayout
      kind={kind}
      left={
        kind === "review" && thread.primarySite ? (
          <TaskNavigation
            key={`${thread.primarySite}:${thread.visibility}`}
            site={thread.primarySite}
            scope={thread.visibility === "private" ? "mine" : "public"}
            current={thread}
            view={showingWalkthrough ? "walkthrough" : "chat"}
          />
        ) : undefined
      }
      addressChrome={
        <>
          <div className="mb-5 flex items-center justify-between gap-4 max-[760px]:mb-3">
            {kind === "review" ? (
              <div className="flex min-w-0 items-center gap-1">
                {thread.primarySite && <TasksToggle />}
                {thread.primarySite ? (
                  <Link
                    to="/sites/$site"
                    params={{ site: thread.primarySite }}
                    search={{
                      scope: thread.visibility === "private" ? "mine" : "public",
                      view: "tasks",
                    }}
                    className={cn(playTextLink, "min-h-11 min-w-0 text-muted-foreground")}
                  >
                    <ArrowLeftIcon size={16} className="shrink-0" aria-hidden="true" />
                    <span className="truncate">{thread.primarySite} tasks</span>
                  </Link>
                ) : (
                  <Link
                    to="/"
                    search={{ scope: thread.visibility === "private" ? "mine" : "public" }}
                    className={cn(playTextLink, "min-h-11 whitespace-nowrap text-muted-foreground")}
                  >
                    <ArrowLeftIcon size={16} aria-hidden="true" /> All sites
                  </Link>
                )}
              </div>
            ) : (
              <Link
                to={productRoutes[kind]}
                search={{}}
                className={cn(playTextLink, "min-h-11 text-muted-foreground")}
              >
                <ArrowLeftIcon size={16} aria-hidden="true" />{" "}
                <span className="whitespace-nowrap">New chat</span>
              </Link>
            )}
            <div className="flex items-center gap-5 max-[760px]:gap-4">
              {thread.isOwner && thread.purpose.kind !== "general" ? (
                <select
                  aria-label="Chat visibility"
                  title="Public shares the chat and browser with anyone."
                  className="min-h-11 rounded-lg bg-transparent text-xs text-muted-foreground"
                  value={thread.visibility}
                  disabled={request.kind === "pending"}
                  onChange={(event) => {
                    void changeVisibility(event.target.value === "public" ? "public" : "private");
                  }}
                >
                  <option value="private">Private</option>
                  <option value="public" disabled={!thread.canControl}>
                    Public
                  </option>
                </select>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {thread.visibility === "public" ? "Public" : "Private"}
                </span>
              )}
              {canInspect && (
                <Link
                  to={managedId ? "/agents" : "/chats"}
                  search={managedId ? { session: managedId } : { thread: threadId }}
                  aria-label="Open in lab"
                  className={cn(playTextLink, "min-h-11 text-muted-foreground")}
                >
                  <span className="whitespace-nowrap">
                    <span className="max-[760px]:hidden">Open in </span>Lab
                  </span>{" "}
                  <ArrowUpRightIcon size={15} aria-hidden="true" />
                </Link>
              )}
              {kind === "play" && <BrowserToggle action="open" />}
              {kind === "play" && canStop && (
                <BrowserStop
                  onStop={() => {
                    void stop();
                  }}
                  disabled={request.kind === "pending"}
                />
              )}
            </div>
          </div>
        </>
      }
      main={
        <section
          aria-label={showingWalkthrough ? "Walkthrough with Scout" : "Conversation with Scout"}
          className="flex h-full min-h-0 flex-col gap-3 min-[768px]:pr-1"
        >
          <header className="shrink-0 space-y-3">
            <div className="flex min-w-0 items-center gap-4">
              {kind === "play" && <ScoutPiece size="brand" className="max-[760px]:hidden" />}
              <h1
                className="truncate text-[28px] font-semibold tracking-[-0.8px] max-[760px]:text-[24px]"
                title={thread.title ?? undefined}
              >
                {thread.title ?? `Chat with ${scout.displayName}`}
              </h1>
            </div>
            {kind === "review" && managedId && (
              <nav
                aria-label="Review views"
                className="flex w-fit items-center gap-1 rounded-lg border bg-card p-1"
              >
                <Button asChild variant={showingWalkthrough ? "secondary" : "ghost"} size="sm">
                  <Link
                    to="/review"
                    search={{ ...search, view: "walkthrough" }}
                    resetScroll={false}
                    onClick={() => setMobilePane("main")}
                    aria-current={showingWalkthrough ? "page" : undefined}
                  >
                    Walkthrough
                  </Link>
                </Button>
                <Button asChild variant={showingWalkthrough ? "ghost" : "secondary"} size="sm">
                  <Link
                    to="/review"
                    search={{ ...search, view: "chat" }}
                    resetScroll={false}
                    onClick={() => setMobilePane("main")}
                    aria-current={!showingWalkthrough ? "page" : undefined}
                  >
                    Chat
                  </Link>
                </Button>
              </nav>
            )}
            {request.kind === "failed" && (
              <p role="alert" className={playError}>
                {request.message}
              </p>
            )}
            {thread.status === "failed" &&
              managed?.state.kind !== "waiting" &&
              managed?.state.kind !== "checking" && (
                <p className={playNotice} role="alert">
                  {managed?.requestCheckMessage ?? "Scout couldn't finish this turn."}
                  {!managed?.requestCheckMessage && (managed ? managed.canSend : thread.canControl)
                    ? " Send a message to try again."
                    : ""}
                </p>
              )}
            {handoff && (
              <ChatHandoffNotice
                handoff={handoff}
                browserClosed={latestSession?.kind === "closed"}
                canCancel={Boolean(canStop) && request.kind !== "pending"}
                onCancel={() => {
                  void stop();
                }}
              />
            )}
            {managed?.state.kind === "waiting" && (
              <div className={cn(playNotice, "space-y-3")}>
                <p className="whitespace-pre-wrap">{managed.state.message}</p>
                {managed.requestCheckMessage && (
                  <p role="alert" className="whitespace-pre-wrap">
                    {managed.requestCheckMessage}
                  </p>
                )}
                {managed.handoffEmailFailed && (
                  <p role="alert">
                    The handoff email couldn’t be sent. You can open the browser here.
                  </p>
                )}
                <div className="flex items-center gap-4">
                  {managed.interactiveLiveViewUrl && (
                    <a
                      href={managed.interactiveLiveViewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={playTextLink}
                    >
                      Open browser <ArrowUpRightIcon size={15} aria-hidden="true" />
                    </a>
                  )}
                  <button
                    type="button"
                    disabled={request.kind === "pending"}
                    className={productButtonVariants({ variant: "play" })}
                    onClick={() => void resume()}
                  >
                    Resume Scout
                  </button>
                </div>
              </div>
            )}
          </header>
          {showingWalkthrough && managedId && (
            <div className="min-h-0 flex-1 overflow-hidden rounded-[var(--product-panel-radius)] border border-border bg-card">
              <TaskWalkthrough sessionId={managedId} />
            </div>
          )}
          <div
            hidden={showingWalkthrough}
            className="min-h-0 flex-1 overflow-hidden rounded-[var(--product-panel-radius)] border border-border bg-card"
          >
            <MessageScrollerProvider autoScroll defaultScrollPosition="end">
              <MessageScroller>
                <MessageScrollerViewport
                  aria-label="Session messages"
                  className="[mask-image:none]"
                >
                  <MessageScrollerContent
                    className="gap-7 px-4 pt-5 pb-7"
                    role="log"
                    aria-label="Session messages"
                    aria-live="polite"
                  >
                    {messages.status === "CanLoadMore" && (
                      <button
                        type="button"
                        className={cn(playTextLink, "self-center py-2")}
                        onClick={() => {
                          messages.loadMore(50);
                        }}
                      >
                        Earlier messages
                      </button>
                    )}
                    {messages.status === "LoadingFirstPage" && (
                      <p role="status" className="text-sm text-muted-foreground">
                        Loading messages…
                      </p>
                    )}
                    {visibleMessages.map((message) => (
                      <MessageScrollerItem
                        key={message.id}
                        messageId={message.id}
                        className={cn(
                          "min-w-0 max-w-[95%] text-[15px] [overflow-wrap:anywhere]",
                          message.role === "user" ? "ml-auto" : "mr-auto",
                        )}
                      >
                        {message.role !== "user" && (
                          <span className="mb-2 block text-xs font-medium text-muted-foreground">
                            {scout?.displayName ?? "Scout"}
                          </span>
                        )}
                        <p
                          className={cn(
                            "whitespace-pre-wrap",
                            message.role === "user" &&
                              "rounded-[var(--product-message-radius)] bg-secondary px-5 py-3.5",
                          )}
                        >
                          {message.role === "user"
                            ? gameInviteDisplayText(message.text)
                            : message.text}
                        </p>
                      </MessageScrollerItem>
                    ))}
                    {(thread.status === "running" || managed?.state.kind === "checking") && (
                      <p
                        role="status"
                        className="flex items-center gap-2.5 text-sm text-muted-foreground"
                      >
                        <LoaderCircleIcon size={15} className="animate-spin" aria-hidden="true" />
                        {managed?.state.kind === "checking"
                          ? "Checking…"
                          : (phaseLabel ?? <span className="sr-only">Scout is working</span>)}
                      </p>
                    )}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton className="size-11" />
              </MessageScroller>
            </MessageScrollerProvider>
          </div>
          {thread.canControl ? (
            showingWalkthrough && thread.status === "finished" ? (
              <Button asChild variant="outline" size="sm" className="self-end">
                <Link
                  to="/review"
                  search={{ ...search, view: "chat" }}
                  resetScroll={false}
                  onClick={() => setMobilePane("main")}
                >
                  Ask a follow-up
                </Link>
              </Button>
            ) : (
              <ConversationComposer
                value={draft}
                onChange={setDraft}
                onSubmit={(event) => {
                  void send(event);
                }}
                disabled={request.kind === "pending"}
                canSend={canSend}
                onStop={
                  canStop
                    ? () => {
                        void stop();
                      }
                    : null
                }
                placeholder="Message Scout…"
              >
                <span role="status">
                  {scout?.status !== "active"
                    ? "This Scout is unavailable."
                    : managedId
                      ? managed?.busy
                        ? "This Scout is busy in another chat."
                        : thread.status === "stopping"
                          ? "Stopping Scout…"
                          : null
                      : activityNotice(activity, threadId)}
                </span>
              </ConversationComposer>
            )
          ) : (
            <Link
              to={productRoutes[kind]}
              search={{}}
              className={cn(productButtonVariants({ variant: "play" }), "self-center my-3")}
            >
              {kind === "play" ? "Play with Scout" : "Review with Scout"}{" "}
              <ArrowRightIcon size={16} />
            </Link>
          )}
        </section>
      }
      right={
        showingWalkthrough ? undefined : (
          <section
            aria-label="Scout's browser"
            className="flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--product-panel-radius)] border border-border bg-secondary/50 min-[768px]:ml-1"
          >
            {session?.kind === "closed" ? (
              <BrowserReplay
                key={session.sessionId}
                sessionId={session.sessionId}
                mode="playback"
                header={browserHeader}
                selectedPageId={
                  search.replay?.sessionId === session.sessionId ? search.replay.pageId : null
                }
                onSelectPage={(pageId) => {
                  void navigate({
                    to: productRoutes[kind],
                    search: {
                      ...search,
                      session: session.sessionId,
                      replay:
                        pageId === null ? undefined : { sessionId: session.sessionId, pageId },
                    },
                  });
                }}
              />
            ) : (
              <>
                {browserHeader}
                {liveView?.url ? (
                  <>
                    <iframe
                      key={session?.sessionId}
                      src={liveView.url}
                      className="min-h-0 w-full flex-1 border-0 bg-white"
                      title="Scout's live browser"
                      sandbox="allow-same-origin allow-scripts"
                      referrerPolicy="no-referrer"
                    />
                    <a
                      className="flex min-h-11 items-center justify-center gap-1.5 p-2.5 text-xs text-muted-foreground hover:text-primary"
                      href={liveView.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open browser <ArrowUpRightIcon size={14} aria-hidden="true" />
                    </a>
                  </>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-6 p-7 text-center">
                    {kind === "play" ? (
                      <div className="grid size-32 place-items-center rounded-full bg-play-sand/80">
                        <ScoutPiece className="-rotate-6" />
                      </div>
                    ) : (
                      <MonitorIcon
                        size={32}
                        strokeWidth={1.25}
                        className="text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                    <p className="max-w-[270px] text-sm text-muted-foreground">
                      {session?.kind === "closing"
                        ? "Closing the browser…"
                        : "Scout hasn’t opened a browser yet."}
                    </p>
                  </div>
                )}
              </>
            )}
          </section>
        )
      }
    />
  );
}

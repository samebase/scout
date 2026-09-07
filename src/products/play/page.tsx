import { accountAccessMessage, canAccess, useViewerAccess } from "../../lib/access";
import { SidebarLayout } from "@samebase/sidebars/SidebarLayout";
import { useUIMessages } from "@convex-dev/agent/react";
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
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Route } from "../../routes/play.session";
import { gameInviteDisplayText } from "./invite";
import { PlayComposer } from "./composer";
import { PlaySidebar, PlayBrowserToggle, PlayBrowserStop } from "./sidebar";
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
import { ChatHandoffNotice } from "../../components/chat-handoff-notice";
import { PlayShell } from "./shell";
import { ScoutPiece } from "./scout-piece";
import { cn } from "#lib/utils";
import { productButtonVariants } from "../ui";
import { playError, playLoading, playNotice, playRouteMessage, playTextLink } from "./ui";

type Scout = FunctionReturnType<typeof api.scout.scouts.list>[number];
type ChatThread = FunctionReturnType<typeof api.scout.chats.listThreads>["page"][number];
type BrowserSession = FunctionReturnType<typeof api.scout.browserSessions.list>[number];
type Activity = FunctionReturnType<typeof api.scout.chats.getScoutActivity>;
type ThreadActivity = Extract<Activity, { threadId: string }>;
type RequestState = { kind: "idle" } | { kind: "pending" } | { kind: "failed"; message: string };

export function PlayPage() {
  const { thread } = Route.useSearch();
  const viewer = useViewerAccess();
  const canRun = viewer?.kind === "account" && canAccess("access_lab", viewer.accessKeys);
  const { isAuthenticated, isLoading } = useConvexAuth();
  return (
    <PlayShell>
      <main
        id="main-content"
        className={
          thread
            ? "mx-auto flex h-[calc(100dvh-112px)] min-h-[540px] max-w-[1456px] flex-col px-12 pt-4 pb-6 max-[1100px]:px-7 max-[760px]:h-[calc(100dvh-85px)] max-[760px]:min-h-[460px] max-[760px]:px-4 max-[760px]:pt-0 max-[760px]:pb-3"
            : "grid min-h-[calc(100dvh-112px)] place-items-center px-5 pt-8 pb-[16vh] max-[760px]:min-h-[calc(100dvh-85px)] max-[760px]:pb-[12vh]"
        }
      >
        {thread ? (
          isLoading || (isAuthenticated && !viewer) ? (
            <p className={playLoading} role="status">
              Loading your session...
            </p>
          ) : isAuthenticated ? (
            canRun ? (
              <SessionLoader threadId={thread} />
            ) : (
              <PlayUnavailable />
            )
          ) : (
            <div className="mx-auto mt-[50px] mb-[100px] max-w-[400px] max-[760px]:px-[15px]">
              <h1 className="text-[34px] tracking-[-1px]">Back for another round?</h1>
              <p className="mt-[15px] mb-[25px] text-play-muted">Sign in to open your session.</p>
              <AuthPanel />
            </div>
          )
        ) : (
          <PlayLobby />
        )}
      </main>
    </PlayShell>
  );
}

function PlayUnavailable() {
  const message = accountAccessMessage(useViewerAccess());
  return (
    <div className="mx-auto max-w-[420px]">
      <h1 className="text-3xl font-semibold">{message?.title ?? "Play access is coming"}</h1>
      <p className="mt-4 text-play-muted">
        {message?.description ??
          "Your account is approved. Scout Play isn’t available for members yet."}
      </p>
      <Link to="/settings" className={cn(playTextLink, "mt-6 inline-flex")}>
        Account settings
      </Link>
    </div>
  );
}

function PlayLobby() {
  const viewer = useViewerAccess();
  const canRun = viewer?.kind === "account" && canAccess("access_lab", viewer.accessKeys);
  const { isAuthenticated, isLoading } = useConvexAuth();
  const scouts = useQuery(api.scout.scouts.list, canRun ? {} : "skip");
  const createThread = useMutation(api.scout.chats.createThread);
  const sendMessage = useMutation(api.scout.chats.sendMessage);
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [selectedScoutId, setSelectedScoutId] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [request, setRequest] = useState<RequestState>({ kind: "idle" });
  const pendingThread = useRef<{ threadId: string; scoutId: Scout["_id"] } | null>(null);
  const submitting = useRef(false);
  const activeScouts = scouts?.filter((scout) => scout.status === "active") ?? [];
  const selectedScout =
    activeScouts.find((scout) => scout._id === selectedScoutId) ?? activeScouts[0];
  const loadingScouts = isLoading || (isAuthenticated && scouts === undefined);
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
      if (pendingThread.current?.scoutId !== selectedScout._id) {
        const created = await createThread({ scoutId: selectedScout._id, purpose: "play" });
        pendingThread.current = { ...created, scoutId: selectedScout._id };
      }
      const { threadId } = pendingThread.current;
      await sendMessage({ threadId, prompt });
      await navigate({ to: "/play/session", search: { thread: threadId } });
    } catch {
      setRequest({
        kind: "failed",
        message:
          "Couldn't invite Scout. It may be busy in another session. Try again, choose another Scout, or check the lab.",
      });
    } finally {
      submitting.current = false;
    }
  }

  if (isAuthenticated && viewer && !canRun) return <PlayUnavailable />;

  return (
    <div className="w-full max-w-[660px]">
      <div className="mb-10 flex flex-col items-center text-center max-[760px]:mb-8">
        <div className="relative mb-8 flex h-[110px] w-[152px] items-center justify-center">
          <span className="absolute inset-x-0 bottom-0 h-14 -rotate-6 rounded-[50%] bg-play-sand" />
          <ScoutPiece className="-rotate-6" />
        </div>
        <h1 className="text-[52px] leading-[1.08] font-semibold tracking-[-2px] max-[760px]:text-[40px]">
          What are we playing?
        </h1>
        <p className="mt-4 text-base text-play-muted">Bring a game, or find one together.</p>
      </div>
      <section aria-label="Start playing">
        {signingIn && !isAuthenticated ? (
          <div className="mx-auto max-w-[400px]">
            <button
              type="button"
              className={cn(playTextLink, "mb-6 text-play-muted")}
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
                <Link
                  to="/scouts"
                  className="mt-2 inline-flex items-center gap-1 underline underline-offset-4"
                >
                  Set up a Scout <ArrowUpRightIcon size={14} aria-hidden="true" />
                </Link>
              </div>
            )}
            <PlayComposer
              value={draft}
              onChange={setDraft}
              onSubmit={(event) => {
                void inviteScout(event);
              }}
              disabled={request.kind === "pending"}
              canSend={!loadingScouts && !noScouts}
              onStop={null}
              placeholder="Let's play… Paste a game link or tell me what you have in mind."
            >
              {loadingScouts ? (
                "Loading players…"
              ) : request.kind === "pending" ? (
                "Starting…"
              ) : activeScouts.length > 0 ? (
                <div className="flex items-center gap-2.5">
                  <ScoutPiece size="brand" className="scale-75" />
                  <label htmlFor="game-scout" className="sr-only">
                    Your player
                  </label>
                  <select
                    id="game-scout"
                    value={selectedScout?._id ?? ""}
                    onChange={(event) => setSelectedScoutId(event.target.value)}
                    className="min-h-11 max-w-[220px] rounded-lg bg-transparent pr-2 text-sm font-medium text-play-ink"
                  >
                    {activeScouts.map((scout) => (
                      <option key={scout._id} value={scout._id}>
                        With {scout.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                "Scout Play"
              )}
            </PlayComposer>
            <div className="mt-5 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-play-muted">
              {["Find a game for us", "Help me learn a game"].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={request.kind === "pending"}
                  onClick={() => setDraft(suggestion)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg hover:text-play-blue"
                >
                  {suggestion} <ArrowRightIcon size={14} aria-hidden="true" />
                </button>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function SessionLoader({ threadId }: { threadId: string }) {
  const threads = usePaginatedQuery(api.scout.chats.listThreads, {}, { initialNumItems: 50 });
  const scouts = useQuery(api.scout.scouts.list);
  const thread = threads.results.find((entry) => entry.threadId === threadId);
  useEffect(() => {
    if (!thread && threads.status === "CanLoadMore") threads.loadMore(50);
  }, [thread, threads]);
  if (!thread) {
    return threads.status === "Exhausted" ? (
      <div className={playRouteMessage}>
        <h1 className="text-[30px]">Session not found</h1>
        <p className="text-play-muted">This session isn't available for your account.</p>
        <Link to="/play/session" search={{}} className={productButtonVariants({ variant: "play" })}>
          Start a new game
        </Link>
      </div>
    ) : (
      <p className={playLoading} role="status">
        Opening your session...
      </p>
    );
  }
  if (!scouts)
    return (
      <p className={playLoading} role="status">
        Loading your player...
      </p>
    );
  return (
    <PlaySidebar key={threadId}>
      <PlaySession thread={thread} scout={scouts.find((scout) => scout._id === thread.scoutId)} />
    </PlaySidebar>
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

function PlaySession({ thread, scout }: { thread: ChatThread; scout: Scout | undefined }) {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/play/session" });
  const { threadId } = thread;
  const activity = useQuery(api.scout.chats.getScoutActivity, { threadId });
  const sessions = useQuery(api.scout.browserSessions.list, { threadId });
  const [selectedSessionId, setSelectedSessionId] = useState<BrowserSession["sessionId"] | null>(
    null,
  );
  const latestSession = sessions?.at(-1);
  const session =
    sessions?.find((session) => session.sessionId === selectedSessionId) ?? latestSession;
  const liveView = useQuery(
    api.scout.browserSessions.liveView,
    session && session.lifecycle.kind !== "closed" ? { sessionId: session.sessionId } : "skip",
  );
  const handoff = useQuery(
    api.humanHandoffs.forSession,
    latestSession ? { sessionId: latestSession.sessionId } : "skip",
  );
  const messages = useUIMessages(
    api.scout.chats.listMessages,
    { threadId },
    { initialNumItems: 50, stream: true },
  );
  const sendMessage = useMutation(api.scout.chats.sendMessage);
  const stopScout = useMutation(api.scout.chats.stop);
  const [draft, setDraft] = useState("");
  const [request, setRequest] = useState<RequestState>({ kind: "idle" });
  const pending = useRef(false);
  const ownActivity = activityForThread(activity, threadId);
  const canStop =
    ownActivity !== undefined && (ownActivity.kind !== "stopping" || ownActivity.retryable);
  const canSend =
    scout?.status === "active" && activity?.kind === "idle" && request.kind !== "pending";
  const visibleMessages = messages.results.filter(
    (message) =>
      message.role !== "system" &&
      (message.text.trim() || message.metadata?.outcome.kind === "failed"),
  );
  const phase = thread.play?.step;
  const phaseLabel = phase
    ? { research: "Researching the game", account_setup: "Setting up an account", play: "Playing" }[
        phase
      ]
    : null;
  const lastTurn = messages.results.findLast((message) => message.metadata)?.metadata;

  async function stop() {
    if (pending.current) return;
    pending.current = true;
    setRequest({ kind: "pending" });
    try {
      await stopScout({ threadId });
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
      await sendMessage({ threadId, prompt });
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

  const browserHeader = (
    <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-play-line px-3 text-[13px]">
      <MonitorIcon size={16} className="shrink-0" aria-hidden="true" />
      {sessions && sessions.length > 1 && session ? (
        <select
          aria-label="Browser session"
          value={session.sessionId}
          onChange={(event) => {
            const selected = sessions.find(
              (session) => session.sessionId === event.currentTarget.value,
            );
            if (selected) setSelectedSessionId(selected.sessionId);
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
              {session.lifecycle.kind === "active"
                ? " · Live"
                : session.lifecycle.kind === "closing"
                  ? " · Closing"
                  : ""}
            </option>
          ))}
        </select>
      ) : (
        <span className="min-w-0 flex-1 font-medium">
          {session?.lifecycle.kind === "closed" ? "Replay" : "Scout’s view"}
        </span>
      )}
      <PlayBrowserToggle action="close" />
    </div>
  );

  return (
    <SidebarLayout
      mobileMinResizeBehavior="min_resize_to_slide"
      resizeHandleLabels={{ left: "Resize chat navigation", right: "Resize Scout’s view" }}
      addressChrome={
        <>
          <div className="mb-5 flex items-center justify-between gap-4 max-[760px]:mb-3">
            <Link
              to="/play/session"
              search={{}}
              className={cn(playTextLink, "min-h-11 text-play-muted")}
            >
              <ArrowLeftIcon size={16} aria-hidden="true" />{" "}
              <span className="whitespace-nowrap">New chat</span>
            </Link>
            <div className="flex items-center gap-5 max-[760px]:gap-4">
              <Link
                to="/chats"
                search={{ thread: threadId }}
                aria-label="Open in lab"
                className={cn(playTextLink, "min-h-11 text-play-muted")}
              >
                <span className="whitespace-nowrap">
                  <span className="max-[760px]:hidden">Open in </span>Lab
                </span>{" "}
                <ArrowUpRightIcon size={15} aria-hidden="true" />
              </Link>
              <PlayBrowserToggle action="open" />
              {canStop && (
                <PlayBrowserStop
                  onStop={() => {
                    void stop();
                  }}
                  disabled={request.kind === "pending"}
                />
              )}
            </div>
          </div>
          <div className="mb-5 flex min-w-0 items-center gap-4 max-[760px]:mb-4">
            <ScoutPiece size="brand" className="max-[760px]:hidden" />
            <h1
              className="truncate text-[28px] font-semibold tracking-[-0.8px] max-[760px]:text-[24px]"
              title={thread.title ?? undefined}
            >
              {thread.title ?? `Play with ${scout?.displayName ?? "Scout"}`}
            </h1>
          </div>
          {request.kind === "failed" && (
            <p role="alert" className={playError}>
              {request.message}
            </p>
          )}
          {lastTurn?.outcome.kind === "failed" && (
            <p className={playNotice} role="alert">
              Scout couldn't finish this turn. Send a message to try again, or open the lab for
              details.
            </p>
          )}
          {handoff && (
            <ChatHandoffNotice
              handoff={handoff}
              browserClosed={latestSession?.lifecycle.kind === "closed"}
              canCancel={Boolean(canStop) && request.kind !== "pending"}
              onCancel={() => {
                void stop();
              }}
            />
          )}
        </>
      }
      main={
        <section
          aria-label="Conversation with Scout"
          className="flex h-full min-h-0 flex-col min-[768px]:pr-6"
        >
          <div className="min-h-0 flex-1">
            <MessageScrollerProvider autoScroll defaultScrollPosition="end">
              <MessageScroller>
                <MessageScrollerViewport aria-label="Game messages" className="[mask-image:none]">
                  <MessageScrollerContent
                    className="gap-7 px-1 pt-5 pb-7"
                    role="log"
                    aria-label="Game messages"
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
                      <p role="status" className="text-sm text-play-muted">
                        Loading messages…
                      </p>
                    )}
                    {visibleMessages.map((message) => (
                      <MessageScrollerItem
                        key={message.key}
                        messageId={message.id}
                        className={cn(
                          "min-w-0 max-w-[95%] text-[15px] [overflow-wrap:anywhere]",
                          message.role === "user" ? "ml-auto" : "mr-auto",
                        )}
                      >
                        {message.role !== "user" && (
                          <span className="mb-2 block text-xs font-medium text-play-muted">
                            {scout?.displayName ?? "Scout"}
                          </span>
                        )}
                        <p
                          className={cn(
                            "whitespace-pre-wrap",
                            message.role === "user" &&
                              "rounded-[20px_20px_4px_20px] bg-play-cloud px-5 py-3.5",
                          )}
                        >
                          {message.role === "user"
                            ? gameInviteDisplayText(message.text)
                            : message.text}
                        </p>
                      </MessageScrollerItem>
                    ))}
                    {ownActivity?.kind === "running" && (
                      <p
                        role="status"
                        className="flex items-center gap-2.5 text-sm text-play-muted"
                      >
                        <LoaderCircleIcon size={15} className="animate-spin" aria-hidden="true" />
                        {phaseLabel ?? <span className="sr-only">Scout is working</span>}
                      </p>
                    )}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton className="size-11" />
              </MessageScroller>
            </MessageScrollerProvider>
          </div>
          <PlayComposer
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
                : activityNotice(activity, threadId)}
            </span>
          </PlayComposer>
        </section>
      }
      right={
        <section
          aria-label="Scout's game browser"
          className="flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] border border-play-line bg-play-cloud/50"
        >
          {session?.lifecycle.kind === "closed" ? (
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
                  search: (previous) => ({
                    ...previous,
                    replay: pageId === null ? undefined : { sessionId: session.sessionId, pageId },
                  }),
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
                    title="Scout's live game browser"
                    sandbox="allow-same-origin allow-scripts"
                    referrerPolicy="no-referrer"
                  />
                  <a
                    className="flex min-h-11 items-center justify-center gap-1.5 p-2.5 text-xs text-play-muted hover:text-play-blue"
                    href={liveView.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open browser <ArrowUpRightIcon size={14} aria-hidden="true" />
                  </a>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-6 p-7 text-center">
                  <div className="grid size-32 place-items-center rounded-full bg-play-sand/80">
                    <ScoutPiece className="-rotate-6" />
                  </div>
                  <p className="max-w-[270px] text-sm text-play-muted">
                    {session?.lifecycle.kind === "closing"
                      ? "Closing the browser…"
                      : "Scout hasn’t opened a browser yet."}
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      }
    />
  );
}

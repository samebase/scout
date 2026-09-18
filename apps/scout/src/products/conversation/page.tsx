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
import { SidebarLayout } from "@samebase/sidebars/SidebarLayout";
import { Link, useNavigate } from "@tanstack/react-router";
import { useConvexAuth, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  LoaderCircleIcon,
  MonitorIcon,
  XIcon,
} from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { omitNullish } from "../../../shared/omitNullish";
import { creditFailure, creditFailureMessage } from "../../../shared/creditFailure";
import { PendingTaskMessage } from "../../tasks/pending-message";
import { scoutAvailabilityLabels } from "#components/scout-current-activity";
import { conversationDestination, type ProductKind, type ConversationSearch } from "./model";
import { gameInviteDisplayText } from "../play/invite";
import { ConversationComposer } from "./composer";
import { ConversationSidebar, BrowserToggle, BrowserStop, TasksToggle } from "./sidebar";
import { TaskNavigation } from "./task-navigation";
import type { ReviewFeedSearch } from "#lib/reviewFeedSearch";
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
import { ToolActivityRow } from "#components/tool-activity";
import { SessionCost } from "#components/session-cost";
import { Button, buttonVariants } from "#components/ui/button";
import { ProductShell } from "../shell";
import { ScoutPiece } from "../play/scout-piece";
import { cn } from "#lib/utils";
import { playError, playNotice, playRouteMessage, playTextLink } from "./ui";

type ChatThread = NonNullable<FunctionReturnType<typeof api.scout.activity.get>>;
const visibilitySchema = z.enum(["public", "private"]);
type RequestState = { kind: "idle" } | { kind: "pending" } | { kind: "failed"; message: string };

export function ConversationError() {
  return (
    <ProductShell>
      <main id="main-content" className={playRouteMessage}>
        <h1 className="text-[30px]">Couldn't open this session</h1>
        <p className="text-muted-foreground">
          The link may be unavailable, or the connection was interrupted.
        </p>
        <Link to="/" className={buttonVariants({ size: "lg" })}>
          Back to activity
        </Link>
      </main>
    </ProductShell>
  );
}

export function ConversationPage({
  kind,
  threadId,
  search,
}: {
  kind: ProductKind;
  threadId: string;
  search: ConversationSearch;
}) {
  return (
    <ProductShell>
      <main id="main-content" className="flex h-[calc(100dvh-4rem)] min-h-0 flex-col">
        <ConversationSidebar>
          <SessionLoader threadId={threadId} kind={kind} search={search} />
        </ConversationSidebar>
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

export function ConversationLobby({
  kind,
  siteSelection,
}: {
  kind: ProductKind;
  siteSelection: { hostname: string; onRemove: () => void } | null;
}) {
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
        product:
          kind === "review"
            ? { kind, ...omitNullish({ site: siteSelection?.hostname }) }
            : { kind },
        scoutId: selectedScout._id,
        prompt,
        visibility,
      });
      await navigate(conversationDestination(kind, threadId, {}));
    } catch (error) {
      setRequest({
        kind: "failed",
        message:
          creditFailure(error)?.message ??
          "Couldn't start the chat. Choose an available Scout and try again.",
      });
    } finally {
      submitting.current = false;
    }
  }

  if (isAuthenticated && viewer && !canRun) return <ConversationUnavailable kind={kind} />;

  return (
    <div className="w-full max-w-[660px]">
      {isPlay && (
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="relative mb-8 flex h-[110px] w-[152px] items-center justify-center">
            <span className="absolute inset-x-0 bottom-0 h-14 -rotate-6 rounded-[50%] bg-muted" />
            <ScoutPiece className="-rotate-6" />
          </div>
          <h1 className="text-[52px] leading-[1.08] font-semibold tracking-[-2px] max-[760px]:text-[40px]">
            What are we playing?
          </h1>
          <p className="mt-4 text-base text-muted-foreground">
            Bring a game, or find one together.
          </p>
        </div>
      )}
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
              autoFocus={siteSelection !== null}
              context={
                siteSelection && (
                  <div className="mb-1 px-2">
                    <button
                      type="button"
                      onClick={siteSelection.onRemove}
                      disabled={request.kind === "pending"}
                      aria-label={`Remove ${siteSelection.hostname} from task`}
                      className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-lg bg-muted px-3 py-1 text-sm hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="truncate">{siteSelection.hostname}</span>
                      <XIcon className="size-3.5 shrink-0" aria-hidden="true" />
                    </button>
                  </div>
                )
              }
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
                  : siteSelection
                    ? "What should Scout do on this site?"
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
  const [opened, setOpened] = useState<{
    thread: ChatThread;
    defaultView: "walkthrough" | "chat";
  } | null>(null);
  if (thread && thread !== opened?.thread) {
    setOpened({
      thread,
      defaultView:
        opened?.thread.threadId === threadId
          ? opened.defaultView
          : kind === "review" &&
              thread.runtime.kind === "task" &&
              thread.status === "finished" &&
              thread.hasWalkthrough
            ? "walkthrough"
            : "chat",
    });
  }
  // Keep only the navigation context while the next task loads. Its content and actions
  // always use the current query result, never the previously opened task.
  const navigationThread = thread === undefined ? opened?.thread : thread;
  const filters: ReviewFeedSearch = {
    site: search.site,
    scope:
      viewer?.kind === "account"
        ? (search.scope ?? (navigationThread?.visibility === "private" ? "mine" : "public"))
        : "public",
  };
  const showingWalkthrough =
    kind === "review" &&
    navigationThread?.runtime.kind === "task" &&
    (search.view ?? opened?.defaultView) === "walkthrough";
  const available = thread && thread.purpose.kind === kind;
  return (
    <SidebarLayout
      resizeHandleLabels={{ left: "Resize task navigation", right: "Resize Scout’s view" }}
      {...omitNullish({
        left:
          kind === "review" && navigationThread?.primarySite ? (
            <TaskNavigation
              key={`${navigationThread.primarySite}:${filters.scope}`}
              site={navigationThread.primarySite}
              search={filters}
              current={navigationThread}
              selectedThreadId={threadId}
              view={showingWalkthrough ? "walkthrough" : "chat"}
            />
          ) : undefined,
        right: showingWalkthrough ? undefined : available ? (
          <ConversationBrowser key={threadId} thread={thread} kind={kind} search={search} />
        ) : (
          <div aria-busy="true" />
        ),
      })}
      addressChrome={
        <header className="flex items-center gap-3 px-3 py-2">
          {navigationThread && (
            <ConversationNavigation thread={navigationThread} kind={kind} search={filters} />
          )}
          {available && (
            <>
              <ConversationTitle thread={thread} kind={kind} />
              {kind === "play" && (
                <ConversationActions key={threadId} thread={thread} kind={kind} />
              )}
              <ConversationInspectorLink thread={thread} />
            </>
          )}
        </header>
      }
      main={
        thread === undefined ? (
          <div className="p-3" role="status">
            Opening task…
          </div>
        ) : !available ? (
          <div className={playRouteMessage}>
            <h1 className="text-[30px]">Session unavailable</h1>
            <p className="text-muted-foreground">This link is private or no longer available.</p>
            <Link to="/" search={filters} className={buttonVariants({ size: "lg" })}>
              Browse activity
            </Link>
            {viewer?.kind !== "account" && <AuthPanel />}
          </div>
        ) : (
          <ConversationSession
            key={threadId}
            thread={thread}
            kind={kind}
            search={search}
            showingWalkthrough={showingWalkthrough}
          />
        )
      }
    />
  );
}

function ConversationTitle({ thread, kind }: { thread: ChatThread; kind: ProductKind }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-4">
      {kind === "play" && <ScoutPiece size="brand" className="max-[760px]:hidden" />}
      <h1
        className="line-clamp-2 min-w-0 text-[28px] leading-tight font-semibold tracking-[-0.8px] wrap-anywhere max-[760px]:text-[24px]"
        title={thread.title ?? undefined}
      >
        {thread.title ?? `Chat with ${thread.scout.displayName}`}
      </h1>
    </div>
  );
}

function ReviewViews({
  threadId,
  search,
  showingWalkthrough,
}: {
  threadId: string;
  search: ConversationSearch;
  showingWalkthrough: boolean;
}) {
  const { setMobilePane } = useSidebarActions();
  return (
    <nav aria-label="Review views" className="flex min-w-0 items-center gap-1 overflow-x-auto">
      <Button asChild variant={showingWalkthrough ? "secondary" : "ghost"} size="sm">
        <Link
          to="/tasks/$thread"
          params={{ thread: threadId }}
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
          to="/tasks/$thread"
          params={{ thread: threadId }}
          search={{ ...search, view: "chat" }}
          resetScroll={false}
          onClick={() => setMobilePane("main")}
          aria-current={!showingWalkthrough ? "page" : undefined}
        >
          Chat &amp; replay
        </Link>
      </Button>
    </nav>
  );
}

function ConversationNavigation({
  thread,
  kind,
  search,
}: {
  thread: ChatThread;
  kind: ProductKind;
  search: ReviewFeedSearch;
}) {
  if (kind === "review" && thread.primarySite) return <TasksToggle />;
  return kind === "review" ? (
    <Link
      to="/"
      search={search}
      className={cn(playTextLink, "min-h-11 shrink-0 whitespace-nowrap text-muted-foreground")}
    >
      <ArrowLeftIcon size={16} aria-hidden="true" /> All sites
    </Link>
  ) : (
    <Link to="/play" search={{}} className={cn(playTextLink, "min-h-11 text-muted-foreground")}>
      <ArrowLeftIcon size={16} aria-hidden="true" />{" "}
      <span className="whitespace-nowrap">New chat</span>
    </Link>
  );
}

function ConversationInspectorLink({ thread }: { thread: ChatThread }) {
  const viewer = useViewerAccess();
  if (
    thread.runtime.kind !== "task" ||
    viewer?.kind !== "account" ||
    !canAccess("access_lab", viewer.accessKeys)
  )
    return null;
  return (
    <Link
      to="/agents"
      search={{ session: thread.runtime.sessionId }}
      aria-label="Open in Agents"
      className={cn(playTextLink, "min-h-11 shrink-0 text-muted-foreground")}
    >
      <span className="whitespace-nowrap">
        <span className="max-[760px]:hidden">Open in </span>Agents
      </span>{" "}
      <ArrowUpRightIcon size={15} aria-hidden="true" />
    </Link>
  );
}

function ConversationActions({ thread, kind }: { thread: ChatThread; kind: ProductKind }) {
  const { threadId } = thread;
  const managedId = thread.runtime.kind === "task" ? thread.runtime.sessionId : null;
  const managed = useQuery(
    api.tasks.sessions.controls,
    kind === "play" && thread.canControl && managedId ? { sessionId: managedId } : "skip",
  );
  const canStop = managed?.canStop === true;
  const setVisibility = useMutation(api.scout.chats.setVisibility);
  const stopManaged = useMutation(api.tasks.sessions.stop);
  const [request, setRequest] = useState<RequestState>({ kind: "idle" });
  const pending = useRef(false);
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
    if (!managedId || pending.current) return;
    pending.current = true;
    setRequest({ kind: "pending" });
    try {
      await stopManaged({ sessionId: managedId });
      setRequest({ kind: "idle" });
    } catch {
      setRequest({ kind: "failed", message: "Couldn't stop. Try again." });
    } finally {
      pending.current = false;
    }
  }
  return (
    <div className="ml-auto flex shrink-0 flex-col items-end gap-2">
      <div className="flex items-center gap-5 max-[760px]:gap-4">
        {thread.isOwner && managedId && thread.purpose.kind !== "general" ? (
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
      {request.kind === "failed" && (
        <p role="alert" className={playError}>
          {request.message}
        </p>
      )}
    </div>
  );
}

function ConversationBrowser({
  thread,
  kind,
  search,
}: {
  thread: ChatThread;
  kind: ProductKind;
  search: ConversationSearch;
}) {
  const navigate = useNavigate();
  const sessions = thread.sessions;
  const session =
    sessions.find((session) => session.sessionId === search.session) ?? sessions.at(-1);
  const liveView = useQuery(
    api.scout.activity.liveView,
    session && session.kind !== "closed" ? { sessionId: session.sessionId } : "skip",
  );
  const browserHeader = (
    <div data-sidebar-layout-part="pane-header" className="gap-2 px-3 text-[13px]">
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
              void navigate(
                conversationDestination(kind, thread.threadId, {
                  ...search,
                  session: selected.sessionId,
                  replay: undefined,
                }),
              );
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
    <section
      aria-label="Scout's browser"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
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
            void navigate(
              conversationDestination(kind, thread.threadId, {
                ...search,
                session: session.sessionId,
                replay: pageId === null ? undefined : { sessionId: session.sessionId, pageId },
              }),
            );
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
                <div className="grid size-32 place-items-center rounded-full bg-muted/80">
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
  );
}

function ConversationSession({
  thread,
  kind,
  search,
  showingWalkthrough,
}: {
  thread: ChatThread;
  kind: ProductKind;
  search: ConversationSearch;
  showingWalkthrough: boolean;
}) {
  const scout = thread.scout;
  const { isAuthenticated } = useConvexAuth();
  const { threadId } = thread;
  const managedId = thread.runtime.kind === "task" ? thread.runtime.sessionId : null;
  const managed = useQuery(
    api.tasks.sessions.controls,
    thread.canControl && managedId ? { sessionId: managedId } : "skip",
  );
  const cost = useQuery(
    api.tasks.sessions.cost,
    thread.canControl && managedId ? { sessionId: managedId } : "skip",
  );
  const messages = usePaginatedQuery(
    api.scout.activity.messages,
    { threadId },
    { initialNumItems: 50 },
  );
  const sendManaged = useMutation(api.tasks.sessions.send);
  const retryManaged = useMutation(api.tasks.sessions.retryMessage);
  const stopManaged = useMutation(api.tasks.sessions.stop);
  const resumeManaged = useMutation(api.tasks.sessions.resume);
  const [draft, setDraft] = useState("");
  const [request, setRequest] = useState<RequestState>({ kind: "idle" });
  const pending = useRef(false);
  const canStop = managed?.canStop === true;
  const pendingMessage = managed?.pendingMessage ?? null;
  const canRetryMessage = managed?.canRetryMessage === true;
  const sendingMessage =
    managed?.active === true && managed.state.kind !== "failed" && managed.state.kind !== "stopped";
  const failure = managed?.state.kind === "failed" ? managed.state : null;
  const failedCreditCode =
    managed?.state.kind === "failed" ? managed.state.creditFailureCode : undefined;
  const canSend =
    thread.canControl &&
    scout.status === "active" &&
    managed?.canSend === true &&
    request.kind !== "pending";
  const visibleMessages = messages.results.toReversed();
  const phase = thread.purpose.kind === "play" ? thread.purpose.step : null;
  const phaseLabel = phase
    ? { research: "Researching the game", account_setup: "Setting up an account", play: "Playing" }[
        phase
      ]
    : null;

  async function stop() {
    if (!managedId || pending.current) return;
    pending.current = true;
    setRequest({ kind: "pending" });
    try {
      await stopManaged({ sessionId: managedId });
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
    if (!managedId || !prompt || !canSend || pending.current) return;
    pending.current = true;
    setRequest({ kind: "pending" });
    try {
      await sendManaged({ sessionId: managedId, message: prompt });
      setDraft("");
      setRequest({ kind: "idle" });
    } catch (error) {
      setRequest({
        kind: "failed",
        message:
          creditFailure(error)?.message ??
          "Your message wasn't sent. Try again when Scout is ready.",
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
    } catch (error) {
      setRequest({
        kind: "failed",
        message: creditFailure(error)?.message ?? "Couldn't resume Scout. Try again.",
      });
    } finally {
      pending.current = false;
    }
  }

  async function retryMessage() {
    if (!managedId || !canRetryMessage || pending.current) return;
    pending.current = true;
    setRequest({ kind: "pending" });
    try {
      await retryManaged({ sessionId: managedId });
      setRequest({ kind: "idle" });
    } catch (error) {
      setRequest({
        kind: "failed",
        message: creditFailure(error)?.message ?? "Couldn't retry your message. Try again.",
      });
    } finally {
      pending.current = false;
    }
  }

  return (
    <section
      aria-label={showingWalkthrough ? "Walkthrough with Scout" : "Conversation with Scout"}
      className="flex h-full min-h-0 min-w-0 flex-col"
    >
      {kind === "review" && (
        <div data-sidebar-layout-part="pane-header" className="justify-between gap-2 px-3">
          {managedId && (
            <ReviewViews
              threadId={threadId}
              search={search}
              showingWalkthrough={showingWalkthrough}
            />
          )}
          <ConversationActions thread={thread} kind={kind} />
        </div>
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
            <p role="alert">The handoff email couldn’t be sent. You can open the browser here.</p>
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
              className={buttonVariants({ size: "lg" })}
              onClick={() => void resume()}
            >
              Resume Scout
            </button>
          </div>
        </div>
      )}
      {showingWalkthrough && managedId && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <TaskWalkthrough sessionId={managedId} />
        </div>
      )}
      <div hidden={showingWalkthrough} className="min-h-0 flex-1 overflow-hidden">
        <MessageScrollerProvider autoScroll defaultScrollPosition="end">
          <MessageScroller>
            <MessageScrollerViewport aria-label="Session messages" className="[mask-image:none]">
              <MessageScrollerContent
                className="gap-2 px-4 pt-5 pb-7"
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
                {visibleMessages.map((message) =>
                  message.kind === "tool" ? (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      className="w-full min-w-0"
                    >
                      <ToolActivityRow tool={message.tool} />
                    </MessageScrollerItem>
                  ) : (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      className={cn(
                        "my-2 min-w-0 max-w-[95%] text-[15px] [overflow-wrap:anywhere]",
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
                          message.role === "user" && "rounded-xl bg-secondary px-5 py-3.5",
                        )}
                      >
                        {message.role === "user"
                          ? gameInviteDisplayText(message.text)
                          : message.text}
                      </p>
                    </MessageScrollerItem>
                  ),
                )}
                {thread.status === "failed" && !thread.canControl && (
                  <MessageScrollerItem messageId="turn-status" className="mr-auto max-w-[95%]">
                    <p className={cn(playNotice, "mb-0 px-3 py-2")} role="alert">
                      Scout couldn't finish this turn.
                    </p>
                  </MessageScrollerItem>
                )}
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
      {thread.canControl && managedId ? (
        <div className="shrink-0 border-t p-3">
          {cost && <SessionCost session={cost} />}
          <PendingTaskMessage
            pendingMessage={pendingMessage}
            active={sendingMessage}
            canRetry={canRetryMessage}
            onRetry={() => void retryMessage()}
            retrying={request.kind === "pending"}
          />
          {failure && (
            <div role="alert" className={cn(playNotice, "mb-3")}>
              <p className="whitespace-pre-wrap wrap-anywhere">
                {failedCreditCode ? (
                  <>
                    {creditFailureMessage(failedCreditCode)}{" "}
                    <Link to="/settings" className={playTextLink}>
                      View credits
                    </Link>
                  </>
                ) : (
                  (managed?.requestCheckMessage ??
                  failure.diagnostic?.message ??
                  failure.error.split(/\r?\n/, 1)[0])
                )}
              </p>
              {!failedCreditCode &&
                !managed?.requestCheckMessage &&
                (failure.diagnostic || failure.error.trimEnd().includes("\n")) && (
                  <details className="mt-2">
                    <summary className="w-fit cursor-pointer rounded text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Details
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap wrap-anywhere select-text">
                      {failure.diagnostic
                        ? JSON.stringify({ ...failure.diagnostic, error: failure.error }, null, 2)
                        : failure.error}
                    </pre>
                  </details>
                )}
              {!pendingMessage &&
                !failedCreditCode &&
                !managed?.requestCheckMessage &&
                managed?.canSend && (
                  <p className="mt-1">
                    {showingWalkthrough ? (
                      <Link
                        to="/tasks/$thread"
                        params={{ thread: threadId }}
                        search={{ ...search, view: "chat" }}
                        resetScroll={false}
                        className={playTextLink}
                      >
                        Send a follow-up to continue.
                      </Link>
                    ) : (
                      "Send a follow-up to continue."
                    )}
                  </p>
                )}
              {!failedCreditCode &&
                !managed?.requestCheckMessage &&
                !managed?.canSend &&
                !managed?.active &&
                !managed?.busy && (
                  <Link to={kind === "play" ? "/play" : "/"} className={cn(playTextLink, "mt-1")}>
                    Start a new task
                  </Link>
                )}
            </div>
          )}
          {request.kind === "failed" && (
            <p role="alert" className={playError}>
              {request.message}
            </p>
          )}
          {!showingWalkthrough && (
            <ConversationComposer
              autoFocus={false}
              context={null}
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
                  : managed?.busy
                    ? "This Scout is busy in another chat."
                    : thread.status === "stopping"
                      ? "Stopping Scout…"
                      : null}
              </span>
            </ConversationComposer>
          )}
        </div>
      ) : (
        !showingWalkthrough && (
          <p className="shrink-0 border-t p-3 text-sm text-muted-foreground">
            {thread.runtime.kind === "convex_agent"
              ? "This older chat is read-only. Its transcript and replay are still available."
              : !isAuthenticated
                ? "Sign in with the account that started this chat to continue it."
                : thread.isOwner
                  ? "Your account doesn't currently have access to continue this chat."
                  : "Only the account that started this chat can send follow-up messages."}
          </p>
        )
      )}
    </section>
  );
}

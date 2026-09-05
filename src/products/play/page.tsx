import { useUIMessages } from "@convex-dev/agent/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useConvexAuth, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  LinkIcon,
  LoaderCircleIcon,
  MonitorIcon,
  SendIcon,
  SquareIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Route } from "../../routes/play.session";
import { gameInviteDisplayText, gameInvitePrompt, gameInviteSchema } from "./invite";
import { AuthPanel } from "../../components/auth-panel";
import { BrowserReplay } from "../../components/browser-replay";
import { ChatHandoffNotice } from "../../components/chat-handoff-notice";
import { PlayShell } from "./shell";
import { ScoutPiece } from "./scout-piece";
import { cn } from "#lib/utils";
import { ProductCard, productButtonVariants } from "../ui";
import {
  playError,
  playInput,
  playLoading,
  playNotice,
  playPanelBar,
  playRouteMessage,
  playTextLink,
} from "./ui";

type Scout = FunctionReturnType<typeof api.scout.scouts.list>[number];
type ChatThread = FunctionReturnType<typeof api.scout.chats.listThreads>["page"][number];
type Activity = FunctionReturnType<typeof api.scout.chats.getScoutActivity>;
type RequestState = { kind: "idle" } | { kind: "pending" } | { kind: "failed"; message: string };

export function PlayPage() {
  const { thread } = Route.useSearch();
  const { isAuthenticated, isLoading } = useConvexAuth();
  return (
    <PlayShell>
      <main
        id="main-content"
        className={
          thread
            ? "mx-auto min-h-[calc(100dvh-112px)] max-w-[1456px] px-16 pt-[22px] pb-[60px] max-[1100px]:px-[30px] max-[760px]:px-5 max-[760px]:pt-[15px] max-[760px]:pb-10"
            : "min-h-[calc(100dvh-112px)] px-[25px] pt-[65px] pb-20 max-[760px]:min-h-[calc(100dvh-85px)] max-[760px]:pt-[35px]"
        }
      >
        {thread ? (
          isLoading ? (
            <p className={playLoading} role="status">
              Loading your session...
            </p>
          ) : isAuthenticated ? (
            <SessionLoader threadId={thread} />
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

function PlayLobby() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const scouts = useQuery(api.scout.scouts.list, isAuthenticated ? {} : "skip");
  const createThread = useMutation(api.scout.chats.createThread);
  const sendMessage = useMutation(api.scout.chats.sendMessage);
  const navigate = useNavigate();
  const [roomUrl, setRoomUrl] = useState("");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
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
    const invite = gameInviteSchema.safeParse({ roomUrl, note });
    if (!invite.success) {
      setRequest({
        kind: "failed",
        message: invite.error.issues[0]?.message ?? "Check your game link and note.",
      });
      return;
    }
    if (!isAuthenticated) {
      setRequest({ kind: "idle" });
      setSigningIn(true);
      return;
    }
    if (!selectedScout) return;
    submitting.current = true;
    setRequest({ kind: "pending" });
    try {
      if (pendingThread.current?.scoutId !== selectedScout._id) {
        const created = await createThread({ scoutId: selectedScout._id });
        pendingThread.current = { ...created, scoutId: selectedScout._id };
      }
      const { threadId } = pendingThread.current;
      await sendMessage({ threadId, prompt: gameInvitePrompt(invite.data) });
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

  return (
    <div className="mx-auto max-w-[420px]">
      <h1 className="mb-[35px] text-[44px] leading-[1.1] font-semibold tracking-[-1.7px] max-[760px]:mb-[30px] max-[760px]:text-[38px]">
        Invite Scout
      </h1>
      <section className="min-w-0" aria-label="Invite Scout">
        {signingIn && !isAuthenticated ? (
          <>
            <button
              type="button"
              className={cn(playTextLink, "mb-6 text-play-muted")}
              onClick={() => setSigningIn(false)}
            >
              <ArrowLeftIcon size={15} aria-hidden="true" /> Back to your invite
            </button>
            <AuthPanel />
          </>
        ) : (
          <>
            <form
              onSubmit={(event) => {
                void inviteScout(event);
              }}
              className="flex flex-col"
            >
              <label
                htmlFor="game-room"
                className="mb-[9px] flex items-center justify-between gap-2.5 text-xs font-semibold"
              >
                Your game link
              </label>
              <div className="relative">
                <LinkIcon
                  size={19}
                  className="absolute top-[14px] left-[13px] text-[#87909f]"
                  aria-hidden="true"
                />
                <input
                  id="game-room"
                  className={cn(playInput, "h-12 pl-10")}
                  name="roomUrl"
                  type="url"
                  required
                  placeholder="https://your-game.com/room/..."
                  value={roomUrl}
                  maxLength={2048}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setRoomUrl(event.target.value)}
                  disabled={request.kind === "pending"}
                />
              </div>
              <button
                type="button"
                className={cn(playTextLink, "mt-4 mb-[25px] self-start text-play-muted")}
                aria-expanded={showNote}
                aria-controls="game-note"
                disabled={request.kind === "pending"}
                onClick={() => {
                  if (showNote) setNote("");
                  setShowNote(!showNote);
                }}
              >
                {showNote ? "Remove note" : "Add a note"}
              </button>
              <label htmlFor="game-note" className="sr-only" hidden={!showNote}>
                Anything Scout should know?
              </label>
              <textarea
                id="game-note"
                className={cn(playInput, "mb-[22px] min-h-[106px] resize-y leading-[1.6]")}
                name="note"
                hidden={!showNote}
                rows={2}
                maxLength={1000}
                placeholder="I'm on blue. Wait for me to start."
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={request.kind === "pending"}
              />
              {activeScouts.length > 1 && (
                <>
                  <label
                    htmlFor="game-scout"
                    className="mb-[9px] flex items-center justify-between gap-2.5 text-xs font-semibold"
                  >
                    Your player
                  </label>
                  <select
                    id="game-scout"
                    className={cn(playInput, "mb-[22px]")}
                    value={selectedScout?._id ?? ""}
                    onChange={(event) => setSelectedScoutId(event.target.value)}
                    disabled={request.kind === "pending"}
                  >
                    {activeScouts.map((scout) => (
                      <option key={scout._id} value={scout._id}>
                        {scout.displayName}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {noScouts && (
                <div className={playNotice} role="status">
                  <strong className="block">No Scout is available yet.</strong>
                  <Link
                    to="/scouts"
                    className="mt-[9px] inline-flex items-center gap-1 underline underline-offset-[3px]"
                  >
                    Set up a Scout <ArrowUpRightIcon size={14} aria-hidden="true" />
                  </Link>
                </div>
              )}
              {request.kind === "failed" && (
                <p className={playError} role="alert">
                  {request.message}
                </p>
              )}
              <button
                className={productButtonVariants({ variant: "play" })}
                type="submit"
                disabled={loadingScouts || noScouts || request.kind === "pending"}
              >
                {request.kind === "pending" ? (
                  <>
                    Inviting Scout{" "}
                    <LoaderCircleIcon size={18} className="animate-spin" aria-hidden="true" />
                  </>
                ) : loadingScouts ? (
                  "Loading players..."
                ) : (
                  <>
                    Invite Scout <ArrowRightIcon size={18} aria-hidden="true" />
                  </>
                )}
              </button>
            </form>
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
    <PlaySession
      key={threadId}
      thread={thread}
      scout={scouts.find((scout) => scout._id === thread.scoutId)}
    />
  );
}

function activityLabel(activity: Activity | undefined, threadId: string) {
  if (!activity) return "Connecting...";
  if (activity.kind !== "idle" && activity.threadId !== threadId)
    return "Playing in another session";
  switch (activity.kind) {
    case "idle":
      return "Ready for your next message";
    case "running":
      return "Scout is playing";
    case "handoff":
      return "Scout needs your help";
    case "stopping":
      return activity.retryable ? "Couldn't stop. Try again." : "Stopping Scout...";
  }
}

function PlaySession({ thread, scout }: { thread: ChatThread; scout: Scout | undefined }) {
  const { threadId } = thread;
  const activity = useQuery(api.scout.chats.getScoutActivity, { threadId });
  const sessions = useQuery(api.scout.browserSessions.list, { threadId });
  const session = sessions?.at(-1);
  const liveView = useQuery(
    api.scout.browserSessions.liveView,
    session ? { sessionId: session.sessionId } : "skip",
  );
  const handoff = useQuery(
    api.humanHandoffs.forSession,
    session ? { sessionId: session.sessionId } : "skip",
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
  const endOfMessages = useRef<HTMLDivElement>(null);
  const messageViewport = useRef<HTMLDivElement>(null);
  const followMessages = useRef(true);
  const pending = useRef(false);
  const ownActivity = activity && activity.kind !== "idle" && activity.threadId === threadId;
  const canStop = ownActivity && (activity.kind !== "stopping" || activity.retryable);
  const canSend =
    scout?.status === "active" && activity?.kind === "idle" && request.kind !== "pending";
  const visibleMessages = messages.results.filter(
    (message) =>
      message.role !== "system" &&
      (message.text.trim() || message.metadata?.outcome.kind === "failed"),
  );
  const lastMessage = visibleMessages.at(-1);
  const lastTurn = messages.results.findLast((message) => message.metadata)?.metadata;
  const initialMessage = messages.results.find((message) => message.role === "user");
  const roomMatch = initialMessage?.text.match(/^Play a game with me at (https?:\/\/\S+)/);
  const room = roomMatch?.[1]
    ? gameInviteSchema.safeParse({ roomUrl: roomMatch[1], note: "" })
    : null;

  useEffect(() => {
    if (followMessages.current) endOfMessages.current?.scrollIntoView({ block: "nearest" });
  }, [lastMessage?.text, lastMessage?.key, activity?.kind]);

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
      followMessages.current = true;
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

  return (
    <>
      <div className="mb-[25px] flex items-end justify-between gap-[25px] max-[760px]:flex-col max-[760px]:items-stretch max-[760px]:gap-[18px]">
        <div>
          <Link
            to="/play/session"
            search={{}}
            className={cn(playTextLink, "mb-[18px] text-play-muted")}
          >
            <ArrowLeftIcon size={15} aria-hidden="true" /> New invite
          </Link>
          <h1 className="text-[31px] font-semibold tracking-[-1px] max-[760px]:text-[27px]">
            At the table with {scout?.displayName ?? "Scout"}
          </h1>
          <p role="status" className="mt-2 flex items-center gap-[7px] text-[11px] text-play-muted">
            <span
              className={cn("size-1.5 rounded-full", ownActivity ? "bg-play-blue" : "bg-[#969da7]")}
            />
            {activityLabel(activity, threadId)}
          </p>
        </div>
        <div className="flex items-center gap-[22px] max-[760px]:justify-between">
          <Link to="/chats" search={{ thread: threadId }} className={playTextLink}>
            Open in lab <ArrowUpRightIcon size={15} aria-hidden="true" />
          </Link>
          {canStop && (
            <button
              type="button"
              className={cn(
                productButtonVariants({ variant: "playSecondary" }),
                "min-h-[39px] px-[14px] text-[11px]",
              )}
              onClick={() => {
                void stop();
              }}
              disabled={request.kind === "pending"}
            >
              <SquareIcon size={13} aria-hidden="true" /> Stop Scout
            </button>
          )}
        </div>
      </div>
      {request.kind === "failed" && (
        <p role="alert" className={playError}>
          {request.message}
        </p>
      )}
      {lastTurn?.outcome.kind === "failed" && (
        <p className={playNotice} role="alert">
          Scout couldn't finish this turn. Send a message to try again, or open the lab for details.
        </p>
      )}
      {handoff && (
        <ChatHandoffNotice
          handoff={handoff}
          browserClosed={session?.lifecycle.kind === "closed"}
          canCancel={Boolean(canStop) && request.kind !== "pending"}
          onCancel={() => {
            void stop();
          }}
        />
      )}
      <div className="grid h-[min(650px,70dvh)] min-h-[500px] grid-cols-[minmax(0,1fr)_330px] gap-[18px] max-[1100px]:grid-cols-[minmax(0,1fr)_290px] max-[760px]:h-auto max-[760px]:grid-cols-1">
        <ProductCard product="play" asChild className="flex min-h-0 flex-col max-[760px]:h-[350px]">
          <section aria-label="Scout's game browser">
            <div className={playPanelBar}>
              <span className="inline-flex items-center gap-[7px] font-semibold">
                <MonitorIcon size={16} aria-hidden="true" /> Scout's view
              </span>
              {room?.success && (
                <a
                  href={room.data.roomUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-[7px] text-[10px] text-play-muted"
                >
                  Open your game <ArrowUpRightIcon size={15} aria-hidden="true" />
                </a>
              )}
            </div>
            {session?.lifecycle.kind === "closed" ? (
              <BrowserReplay sessionId={session.sessionId} />
            ) : liveView?.url ? (
              <>
                <iframe
                  src={liveView.url}
                  className="min-h-0 w-full flex-1 border-0"
                  title="Scout's live game browser"
                  sandbox="allow-same-origin allow-scripts"
                  referrerPolicy="no-referrer"
                />
                <a
                  className="flex items-center justify-center gap-1.5 p-2.5 text-center text-[10px] text-play-muted"
                  href={liveView.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Scout's view in another tab <ArrowUpRightIcon size={14} aria-hidden="true" />
                </a>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-[18px] bg-[#f0f2f8] p-[30px] text-center">
                <ScoutPiece className="mb-[13px] -rotate-8" />
                <h2 className="text-[22px] font-semibold tracking-[-0.6px]">
                  {session?.lifecycle.kind === "closing"
                    ? "Closing the browser"
                    : activity?.kind === "running"
                      ? "Scout is getting ready"
                      : "Scout's view will appear here"}
                </h2>
                <p className="max-w-[300px] text-xs text-play-muted">
                  {activity?.kind === "running"
                    ? "Keep your game open. You can follow Scout's progress here."
                    : "Send Scout a message to continue playing."}
                </p>
              </div>
            )}
          </section>
        </ProductCard>
        <ProductCard product="play" asChild className="flex min-h-0 flex-col max-[760px]:h-[450px]">
          <section aria-label="Conversation with Scout">
            <div className={playPanelBar}>
              <span className="inline-flex items-center gap-[7px] font-semibold">
                <span className="relative inline-flex size-5 items-center gap-[7px]">
                  <ScoutPiece className="absolute -top-[26px] -left-[26px] scale-[0.24]" />
                </span>
                {scout?.displayName ?? "Scout"}
              </span>
              <span className="inline-flex items-center gap-[7px]">Chat</span>
            </div>
            <div
              className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-[17px] py-5"
              ref={messageViewport}
              role="log"
              aria-label="Game messages"
              aria-live="polite"
              onScroll={() => {
                const viewport = messageViewport.current;
                if (viewport)
                  followMessages.current =
                    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80;
              }}
            >
              {messages.status === "CanLoadMore" && (
                <button
                  type="button"
                  className={playTextLink}
                  onClick={() => {
                    followMessages.current = false;
                    messages.loadMore(50);
                  }}
                >
                  Earlier messages
                </button>
              )}
              {messages.status === "LoadingFirstPage" && (
                <p
                  role="status"
                  className="mt-2 flex items-center gap-[7px] text-[11px] text-play-muted"
                >
                  Loading messages...
                </p>
              )}
              {visibleMessages.map((message) => (
                <div key={message.key} className="min-w-0 text-xs [overflow-wrap:anywhere]">
                  <span className="mb-[7px] block text-[10px] font-semibold">
                    {message.role === "user" ? "You" : (scout?.displayName ?? "Scout")}
                  </span>
                  <p
                    className={cn(
                      "whitespace-pre-wrap",
                      message.role === "user" && "rounded-[9px] bg-play-cloud p-3",
                    )}
                  >
                    {message.role === "user" ? gameInviteDisplayText(message.text) : message.text}
                  </p>
                </div>
              ))}
              {ownActivity && activity.kind === "running" && (
                <p className="flex items-center gap-2 text-[11px] text-play-muted">
                  <LoaderCircleIcon size={14} className="animate-spin" aria-hidden="true" /> Scout
                  is taking a turn...
                </p>
              )}
              <div ref={endOfMessages} />
            </div>
            <form
              className="border-t border-play-line p-[14px]"
              onSubmit={(event) => {
                void send(event);
              }}
            >
              <label className="sr-only" htmlFor="game-message">
                Message Scout
              </label>
              <div className="relative">
                <textarea
                  id="game-message"
                  className={cn(playInput, "min-h-[71px] max-h-[170px] resize-y pr-[46px]")}
                  placeholder="A hint? A new plan?"
                  value={draft}
                  maxLength={16000}
                  rows={2}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={request.kind === "pending"}
                />
                <button
                  type="submit"
                  aria-label="Send message"
                  disabled={!canSend || !draft.trim()}
                  className="absolute right-2.5 bottom-[13px] grid size-[29px] place-items-center rounded-md bg-play-blue text-white"
                >
                  <SendIcon size={18} aria-hidden="true" />
                </button>
              </div>
              {activity?.kind !== "idle" && (
                <p className="mt-2 text-[10px] text-play-muted">
                  Stop Scout before sending new guidance.
                </p>
              )}
              {scout?.status !== "active" && (
                <p className="mt-2 text-[10px] text-play-muted">
                  This Scout is unavailable. Choose another player in a new invite.
                </p>
              )}
            </form>
          </section>
        </ProductCard>
      </div>
    </>
  );
}

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
import { gameInvitePrompt, gameInviteSchema } from "./invite";
import { AuthPanel } from "../../components/auth-panel";
import { BrowserReplay } from "../../components/browser-replay";
import { ChatHandoffNotice } from "../../components/chat-handoff-notice";
import { PlayShell, ScoutPiece } from "./shell";

type Scout = FunctionReturnType<typeof api.scout.scouts.list>[number];
type ChatThread = FunctionReturnType<typeof api.scout.chats.listThreads>["page"][number];
type Activity = FunctionReturnType<typeof api.scout.chats.getScoutActivity>;
type RequestState = { kind: "idle" } | { kind: "pending" } | { kind: "failed"; message: string };

export function PlayPage() {
  const { thread } = Route.useSearch();
  const { isAuthenticated, isLoading } = useConvexAuth();
  return (
    <PlayShell>
      <main id="main-content" className={thread ? "play-session-page" : "play-lobby-page"}>
        {thread ? (
          isLoading ? (
            <p className="play-loading" role="status">
              Loading your session...
            </p>
          ) : isAuthenticated ? (
            <SessionLoader threadId={thread} />
          ) : (
            <div className="play-signin">
              <h1>Back for another round?</h1>
              <p>Sign in to open your session.</p>
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
    <div className="play-lobby">
      <h1>Invite Scout</h1>
      <section className="play-invite-card" aria-label="Invite Scout">
        {signingIn && !isAuthenticated ? (
          <>
            <button
              type="button"
              className="play-text-link play-back"
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
              className="play-invite-form"
            >
              <label htmlFor="game-room">Your game link</label>
              <div className="play-url-field">
                <LinkIcon size={19} aria-hidden="true" />
                <input
                  id="game-room"
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
                className="play-note-toggle play-text-link"
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
                  <label htmlFor="game-scout">Your player</label>
                  <select
                    id="game-scout"
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
                <div className="play-notice" role="status">
                  <strong>No Scout is available yet.</strong>
                  <Link to="/scouts">
                    Set up a Scout <ArrowUpRightIcon size={14} aria-hidden="true" />
                  </Link>
                </div>
              )}
              {request.kind === "failed" && (
                <p className="play-error" role="alert">
                  {request.message}
                </p>
              )}
              <button
                className="play-button"
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
      <div className="play-route-message">
        <h1>Session not found</h1>
        <p>This session isn't available for your account.</p>
        <Link to="/play/session" search={{}} className="play-button">
          Start a new game
        </Link>
      </div>
    ) : (
      <p className="play-loading" role="status">
        Opening your session...
      </p>
    );
  }
  if (!scouts)
    return (
      <p className="play-loading" role="status">
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
      <div className="play-session-heading">
        <div>
          <Link to="/play/session" search={{}} className="play-text-link play-back">
            <ArrowLeftIcon size={15} aria-hidden="true" /> New invite
          </Link>
          <h1>At the table with {scout?.displayName ?? "Scout"}</h1>
          <p role="status">
            <span
              className={
                ownActivity ? "play-status-dot play-status-dot--active" : "play-status-dot"
              }
            />
            {activityLabel(activity, threadId)}
          </p>
        </div>
        <div className="play-session-actions">
          <Link to="/chats" search={{ thread: threadId }} className="play-text-link">
            Open in lab <ArrowUpRightIcon size={15} aria-hidden="true" />
          </Link>
          {canStop && (
            <button
              type="button"
              className="play-button play-button--secondary"
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
        <p role="alert" className="play-error">
          {request.message}
        </p>
      )}
      {lastTurn?.outcome.kind === "failed" && (
        <p className="play-notice" role="alert">
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
      <div className="play-session-grid">
        <section className="play-browser" aria-label="Scout's game browser">
          <div className="play-panel-bar">
            <span>
              <MonitorIcon size={16} aria-hidden="true" /> Scout's view
            </span>
            {room?.success && (
              <a href={room.data.roomUrl} target="_blank" rel="noreferrer">
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
                title="Scout's live game browser"
                sandbox="allow-same-origin allow-scripts"
                referrerPolicy="no-referrer"
              />
              <a
                className="play-browser__external"
                href={liveView.url}
                target="_blank"
                rel="noreferrer"
              >
                Open Scout's view in another tab <ArrowUpRightIcon size={14} aria-hidden="true" />
              </a>
            </>
          ) : (
            <div className="play-browser__empty">
              <ScoutPiece />
              <h2>
                {session?.lifecycle.kind === "closing"
                  ? "Closing the browser"
                  : activity?.kind === "running"
                    ? "Scout is getting ready"
                    : "Scout's view will appear here"}
              </h2>
              <p>
                {activity?.kind === "running"
                  ? "Keep your game open. You can follow Scout's progress here."
                  : "Send Scout a message to continue playing."}
              </p>
            </div>
          )}
        </section>
        <section className="play-chat" aria-label="Conversation with Scout">
          <div className="play-panel-bar">
            <span>
              <span className="play-mini-avatar">
                <ScoutPiece />
              </span>
              {scout?.displayName ?? "Scout"}
            </span>
            <span>Chat</span>
          </div>
          <div
            className="play-chat__messages"
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
                className="play-text-link"
                onClick={() => {
                  followMessages.current = false;
                  messages.loadMore(50);
                }}
              >
                Earlier messages
              </button>
            )}
            {messages.status === "LoadingFirstPage" && <p role="status">Loading messages...</p>}
            {visibleMessages.map((message) => (
              <div
                key={message.key}
                className={`play-chat__message play-chat__message--${message.role}`}
              >
                <span>{message.role === "user" ? "You" : (scout?.displayName ?? "Scout")}</span>
                <p>
                  {message.text.startsWith("Play a game with me at ")
                    ? message.text
                        .split("\n\n")
                        .filter((_, index) => index !== 1)
                        .join("\n\n")
                        .replace("My note: ", "")
                    : message.text}
                </p>
              </div>
            ))}
            {ownActivity && activity.kind === "running" && (
              <p className="play-chat__thinking">
                <LoaderCircleIcon size={14} className="animate-spin" aria-hidden="true" /> Scout is
                taking a turn...
              </p>
            )}
            <div ref={endOfMessages} />
          </div>
          <form
            className="play-chat__composer"
            onSubmit={(event) => {
              void send(event);
            }}
          >
            <label className="sr-only" htmlFor="game-message">
              Message Scout
            </label>
            <div>
              <textarea
                id="game-message"
                placeholder="A hint? A new plan?"
                value={draft}
                maxLength={16000}
                rows={2}
                onChange={(event) => setDraft(event.target.value)}
                disabled={request.kind === "pending"}
              />
              <button type="submit" aria-label="Send message" disabled={!canSend || !draft.trim()}>
                <SendIcon size={18} aria-hidden="true" />
              </button>
            </div>
            {activity?.kind !== "idle" && <p>Stop Scout before sending new guidance.</p>}
            {scout?.status !== "active" && (
              <p>This Scout is unavailable. Choose another player in a new invite.</p>
            )}
          </form>
        </section>
      </div>
    </>
  );
}

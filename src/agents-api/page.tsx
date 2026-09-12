import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import { SidebarLayout } from "@samebase/sidebars/SidebarLayout";
import { useSidebarActions, useSidebarLayoutPresentation } from "@samebase/sidebars/SidebarRuntime";
import { Link, useNavigate, type ErrorComponentProps } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  PanelLeftIcon,
  PanelRightIcon,
  PlusIcon,
  RotateCcwIcon,
  SendIcon,
  SquareIcon,
} from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { api } from "../../convex/_generated/api";
import { omitNullish } from "../../shared/omitNullish";
import { Button } from "#components/ui/button";
import { Textarea } from "#components/ui/textarea";
import { sessionControls, type AgentsSearch, type Session } from "./model";
import { Transcript } from "./transcript";
import { BrowserPanel } from "./browser";
import { SessionCost } from "./cost";

type RequestState = { kind: "idle" } | { kind: "pending" } | { kind: "failed"; message: string };

export function AgentsPage({ search }: { search: AgentsSearch }) {
  return (
    <main className="flex h-[calc(100dvh-4rem)] min-h-0 w-full flex-col select-text">
      {search.session === undefined ? (
        <AgentsWorkspace search={search} session={null} />
      ) : (
        <SessionLoader key={search.session} search={search} sessionId={search.session} />
      )}
    </main>
  );
}

function AgentsWorkspace({ search, session }: { search: AgentsSearch; session: Session | null }) {
  const sessions = useQuery(api.agentsApi.sessions.list, {});
  const orderedSessions = sessions?.toSorted(
    (left, right) => right._creationTime - left._creationTime || left._id.localeCompare(right._id),
  );

  return (
    <SidebarLayout
      addressChrome={<AgentsChrome session={session} />}
      resizeHandleLabels={{ left: "Resize sessions", right: "Resize browser" }}
      formatResizeHandleValueText={({ widthPx }) => `${widthPx} pixels wide`}
      left={
        <PaneFrame
          scrollRestorationId="agents-sessions"
          content={
            <aside aria-label="Sessions">
              {sessions === undefined ? (
                <p role="status" className="p-4 text-sm text-muted-foreground">
                  Loading sessions…
                </p>
              ) : sessions.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No sessions yet.</p>
              ) : (
                <nav className="flex flex-col gap-1 p-2" aria-label="Agent sessions">
                  {orderedSessions?.map((session) => (
                    <Link
                      key={session._id}
                      to="/agents"
                      search={{
                        session: session._id,
                        sessions: search.sessions,
                        inspector: search.inspector,
                      }}
                      aria-current={search.session === session._id ? "page" : undefined}
                      className="rounded-lg px-3 py-2.5 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-muted"
                    >
                      <span className="block truncate font-medium">{session.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {session.scoutName}
                      </span>
                    </Link>
                  ))}
                </nav>
              )}
            </aside>
          }
        />
      }
      main={session ? <SessionView session={session} /> : <PaneFrame content={<NewSession />} />}
      {...omitNullish({
        right: session ? <BrowserPanel sessionId={session._id} search={search} /> : undefined,
      })}
    />
  );
}

function AgentsChrome({ session }: { session: Session | null }) {
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
        aria-label={navigationShown ? "Hide sessions" : "Show sessions"}
        aria-pressed={navigationShown}
        onClick={() =>
          isMobile ? setMobilePane(navigationShown ? "main" : "left") : toggleLeftPane()
        }
      >
        <PanelLeftIcon aria-hidden="true" />
      </Button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold" title={session?.title}>
          {session?.title ?? "Agents"}
        </h1>
        {session && <p className="truncate text-xs text-muted-foreground">{session.scoutName}</p>}
      </div>
      {session && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={browserShown ? "Hide browser" : "Show browser"}
          aria-pressed={browserShown}
          onClick={() =>
            isMobile ? setMobilePane(browserShown ? "main" : "right") : toggleRightPane()
          }
        >
          <PanelRightIcon aria-hidden="true" />
        </Button>
      )}
      <Button asChild variant="ghost" size="sm">
        <Link to="/agents" search={{}}>
          <PlusIcon aria-hidden="true" />
          New
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
    (scoutId === "" ? activeScouts?.[0] : undefined);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedScout || !prompt.trim() || submitting.current) return;
    submitting.current = true;
    setRequest({ kind: "pending" });
    try {
      const sessionId = await start({ scoutId: selectedScout._id, prompt: prompt.trim() });
      await navigate({ search: { session: sessionId } });
    } catch (error) {
      setRequest({
        kind: "failed",
        message: error instanceof Error ? error.message : "Could not start session.",
      });
    } finally {
      submitting.current = false;
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col justify-center px-4 py-10 sm:px-8">
      <h2 className="mb-6 text-2xl font-semibold tracking-tight">New session</h2>
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
              <option key={scout._id} value={scout._id}>
                {scout.displayName}
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
            disabled={!selectedScout || !prompt.trim() || request.kind === "pending"}
          >
            {request.kind === "pending" ? "Starting…" : "Start"}
          </Button>
        </div>
      </form>
    </section>
  );
}

function SessionLoader({ sessionId, search }: { sessionId: string; search: AgentsSearch }) {
  const session = useQuery(api.agentsApi.sessions.get, {
    // @ts-expect-error The server validates this URL string with v.id("agentsApiSessions"); downstream calls use the returned typed _id.
    sessionId,
  });
  if (session === undefined)
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        Opening session…
      </p>
    );
  if (session === null)
    return <p className="p-6 text-sm text-muted-foreground">Session not found.</p>;
  return <AgentsWorkspace search={search} session={session} />;
}

function SessionView({ session }: { session: Session }) {
  const send = useMutation(api.agentsApi.sessions.send);
  const stop = useMutation(api.agentsApi.sessions.stop);
  const resume = useMutation(api.agentsApi.sessions.resume);
  const refresh = useAction(api.agentsApi.runtime.refresh);
  const [draft, setDraft] = useState("");
  const [request, setRequest] = useState<RequestState>({ kind: "idle" });
  const submitting = useRef(false);
  const controls = sessionControls(session.state);
  const canSend =
    controls.canSend && !session.active && Boolean(session.providerId) && Boolean(draft.trim());
  const canStop = controls.canStop || session.active;
  const error =
    session.cleanupError ?? (session.state.kind === "failed" ? session.state.error : null);
  const pending = request.kind === "pending";

  async function run(operation: "send" | "stop" | "resume" | "refresh") {
    if (submitting.current) return;
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
          await resume({ sessionId: session._id });
          break;
        case "refresh":
          await refresh({ sessionId: session._id });
          break;
      }
      setRequest({ kind: "idle" });
    } catch (error) {
      setRequest({
        kind: "failed",
        message: error instanceof Error ? error.message : `Could not ${operation} session.`,
      });
    } finally {
      submitting.current = false;
    }
  }

  return (
    <section aria-label="Conversation" className="flex h-full min-h-0 min-w-0 flex-col">
      <Transcript sessionId={session._id} />
      <div className="shrink-0 space-y-3 border-t p-4">
        <div className="flex items-start justify-between gap-3">
          <SessionCost session={session} />
          {!session.active && (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Refresh session"
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
            <Button disabled={pending} onClick={() => void run("resume")}>
              Resume
            </Button>
          </div>
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
            className="max-h-48 min-h-20 resize-none"
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
            New session
          </Link>
        </Button>
      </div>
    </main>
  );
}

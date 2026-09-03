import { Link } from "@tanstack/react-router";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useAction,
  useConvexAuth,
} from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ExternalLinkIcon, HandIcon, LoaderCircleIcon, RotateCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { AuthPanel } from "#components/auth-panel";
import { Button } from "#components/ui/button";
import { consumeHumanHandoffAccessToken, humanHandoffIsTopLevel } from "#lib/human-handoff-access";

type HandoffPage = FunctionReturnType<typeof api.humanHandoffAccess.load>;
type PageState =
  | { kind: "loading" }
  | { kind: "ready"; page: HandoffPage }
  | { kind: "failed"; message: string };

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function handoffCountdown(remainingMilliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMilliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function HandoffCountdown({ expiresAt, serverNow }: { expiresAt: number; serverNow: number }) {
  const initialRemaining = Math.max(0, expiresAt - serverNow);
  const [remaining, setRemaining] = useState(initialRemaining);

  useEffect(() => {
    const startedAt = Date.now();
    const update = () => {
      setRemaining(Math.max(0, initialRemaining - (Date.now() - startedAt)));
    };
    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, [initialRemaining]);

  return handoffCountdown(remaining);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function HumanHandoffPage({ handoffId }: { handoffId: string }) {
  const loadHandoff = useAction(api.humanHandoffAccess.load);
  const continueHandoff = useAction(api.humanHandoffAccess.continueHandoff);
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const [accessToken, setAccessToken] = useState<string | null | undefined>(undefined);
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [continuing, setContinuing] = useState(false);

  useEffect(() => {
    if (!humanHandoffIsTopLevel(window)) {
      setState({ kind: "failed", message: "Open this handoff in a top-level browser tab." });
      return;
    }
    try {
      setAccessToken(consumeHumanHandoffAccessToken(window));
    } catch {
      setState({
        kind: "failed",
        message: "Scout could not remove the private handoff key from browser history.",
      });
    }
  }, []);

  const load = useCallback(async () => {
    if (accessToken === undefined || authLoading) return;
    setState({ kind: "loading" });
    try {
      const page = await loadHandoff({
        handoffId,
        ...(accessToken === null ? {} : { accessToken }),
      });
      setState({ kind: "ready", page });
    } catch (error) {
      setState({ kind: "failed", message: errorMessage(error, "Could not load this handoff.") });
    }
  }, [accessToken, authLoading, handoffId, loadHandoff]);

  useEffect(() => {
    void load();
  }, [isAuthenticated, load]);

  useEffect(() => {
    if (state.kind !== "ready" || state.page.status !== "waiting") return;
    const expiryTimer = window.setTimeout(
      () => void load(),
      Math.max(0, state.page.expiresAt - state.page.serverNow),
    );
    return () => window.clearTimeout(expiryTimer);
  }, [load, state]);

  const submit = async () => {
    if (accessToken === undefined || continuing || !humanHandoffIsTopLevel(window)) return;
    setContinuing(true);
    try {
      const page = await continueHandoff({
        handoffId,
        ...(accessToken === null ? {} : { accessToken }),
      });
      setState({ kind: "ready", page });
    } catch (error) {
      setState({
        kind: "failed",
        message: errorMessage(error, "Scout could not continue from this handoff."),
      });
    } finally {
      setContinuing(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col p-4 sm:p-6">
      <header className="mb-4 flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-md bg-amber-100 text-amber-800">
          <HandIcon className="size-4" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold">Scout human handoff</p>
          <p className="text-muted-foreground text-xs">Complete only the requested human step.</p>
        </div>
      </header>

      {state.kind === "loading" ? (
        <HandoffNotice
          icon={<LoaderCircleIcon className="size-5 animate-spin" />}
          title="Loading secure handoff"
        >
          Scout is checking the exact browser session and your access.
        </HandoffNotice>
      ) : state.kind === "failed" ? (
        <HandoffNotice title="Handoff unavailable">
          <p>{state.message}</p>
          {accessToken === undefined ? null : (
            <Button className="mt-4" size="sm" variant="outline" onClick={() => void load()}>
              <RotateCwIcon /> Retry
            </Button>
          )}
        </HandoffNotice>
      ) : (
        <HandoffState page={state.page} continuing={continuing} onContinue={() => void submit()} />
      )}
    </main>
  );
}

function HandoffState({
  page,
  continuing,
  onContinue,
}: {
  page: HandoffPage;
  continuing: boolean;
  onContinue: () => void;
}) {
  if (page.status === "invalid") {
    return (
      <HandoffNotice title="This handoff is not available">
        The link is invalid, no longer authorizes access, or belongs to another account.
      </HandoffNotice>
    );
  }
  if (page.status === "waiting") {
    return (
      <section
        className="surface-panel flex min-h-0 flex-1 flex-col overflow-hidden"
        aria-label="Active human handoff"
      >
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{page.scoutName} needs your help</p>
            <p className="text-muted-foreground mt-0.5 text-xs">{page.reason}</p>
          </div>
          <time
            className="text-muted-foreground text-xs tabular-nums"
            dateTime={new Date(page.expiresAt).toISOString()}
            title={`Expires ${dateTime.format(page.expiresAt)}`}
          >
            Expires in <HandoffCountdown expiresAt={page.expiresAt} serverNow={page.serverNow} />
          </time>
          <Button asChild size="sm" variant="outline">
            <a
              href={page.interactiveLiveViewUrl}
              target="_blank"
              rel="noreferrer noopener"
              referrerPolicy="no-referrer"
            >
              Open browser in a new tab <ExternalLinkIcon />
            </a>
          </Button>
          <Button size="sm" disabled={continuing} onClick={onContinue}>
            {continuing ? <LoaderCircleIcon className="animate-spin" /> : null}
            {continuing ? "Continuing Scout" : "I completed the check. Continue Scout"}
          </Button>
        </div>
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">
          This five-minute timer started when the handoff first opened. If you use the new tab,
          close it before returning control to Scout.
        </p>
        <iframe
          className="min-h-[32rem] flex-1 border-0"
          src={page.interactiveLiveViewUrl}
          title="Interactive Scout browser"
          referrerPolicy="no-referrer"
          sandbox="allow-forms allow-same-origin allow-scripts"
        />
      </section>
    );
  }

  const title =
    page.status === "continued"
      ? "Control returned to Scout"
      : page.status === "expired"
        ? "This handoff expired"
        : "This handoff failed";
  const message =
    page.status === "continued"
      ? "Scout will continue in the chat."
      : page.status === "expired"
        ? page.claimed
          ? "The five-minute control window ended. Return to the chat to try again."
          : "The private link was not opened within 45 minutes. Return to the chat to try again."
        : page.failure === "delivery_failed"
          ? "Scout could not deliver the secure link. Return to the chat to try again."
          : page.failure === "scout_failed"
            ? "Scout stopped before resuming. Return to the chat to try again."
            : "The browser session ended. Return to the chat to try again.";
  return (
    <HandoffNotice title={title}>
      <p>{message}</p>
      {page.destination ? (
        <Button asChild className="mt-4" size="sm">
          <Link to="/chats" search={{ thread: page.destination.threadId }}>
            Return to chat
          </Link>
        </Button>
      ) : (
        <div className="mt-6 max-w-md text-left">
          <AuthLoading>
            <p className="text-muted-foreground text-sm">Checking your account…</p>
          </AuthLoading>
          <Unauthenticated>
            <p className="mb-3 text-sm">Sign in to return to this chat.</p>
            <AuthPanel />
          </Unauthenticated>
          <Authenticated>
            <p className="text-sm">Switch to the chat owner's account to return.</p>
          </Authenticated>
        </div>
      )}
    </HandoffNotice>
  );
}

function HandoffNotice({
  children,
  icon,
  title,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  title: string;
}) {
  return (
    <section className="surface-panel grid flex-1 place-items-center p-6 text-center" role="status">
      <div className="max-w-lg">
        {icon ? <span className="mx-auto mb-3 grid size-10 place-items-center">{icon}</span> : null}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <div className="text-muted-foreground mt-2 text-sm leading-6">{children}</div>
      </div>
    </section>
  );
}

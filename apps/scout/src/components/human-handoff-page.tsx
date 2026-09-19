import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import {
  consumeHumanHandoffAccessToken,
  humanHandoffIsTopLevel,
} from "../lib/human-handoff-access";
import { Button } from "./ui/button";

type HandoffPage = FunctionReturnType<typeof api.tasks.handoff.load>;
type Access =
  | { status: "loading" }
  | { status: "ready"; accessToken: string }
  | { status: "unavailable"; message: string };

function HandoffCountdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1_000));
  return (
    <time
      role="timer"
      aria-label="Time remaining"
      dateTime={new Date(expiresAt).toISOString()}
      title={`Available until ${new Date(expiresAt).toLocaleString()}`}
      className="inline-flex shrink-0 items-baseline gap-2 rounded-lg bg-muted px-3 py-2 text-3xl font-semibold tabular-nums"
    >
      <span>
        {Math.floor(seconds / 60)}:{(seconds % 60).toString().padStart(2, "0")}
      </span>{" "}
      <span className="text-sm font-medium text-muted-foreground">remaining</span>
    </time>
  );
}

export function HumanHandoffPage({ sessionId }: { sessionId: string }) {
  const [access, setAccess] = useState<Access>({ status: "loading" });
  useEffect(() => {
    if (!humanHandoffIsTopLevel(window)) {
      setAccess({ status: "unavailable", message: "Open the email link in its own browser tab." });
      return;
    }
    function readAccess() {
      try {
        const accessToken = consumeHumanHandoffAccessToken(window);
        setAccess(
          accessToken
            ? { status: "ready", accessToken }
            : {
                status: "unavailable",
                message:
                  "This link is missing a valid access token. Open the complete link from your email.",
              },
        );
      } catch (caught) {
        setAccess({ status: "unavailable", message: requestError(caught) });
      }
    }
    readAccess();
    window.addEventListener("hashchange", readAccess);
    return () => window.removeEventListener("hashchange", readAccess);
  }, [sessionId]);

  return (
    <main
      aria-busy={access.status === "loading"}
      className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-3 py-3 sm:gap-5 sm:px-6 sm:py-8"
    >
      {access.status === "unavailable" ? (
        <p role="alert" className="px-3 sm:px-0">
          {access.message}
        </p>
      ) : null}
      {access.status === "ready" ? (
        <HandoffSession
          key={access.accessToken}
          sessionId={sessionId}
          accessToken={access.accessToken}
        />
      ) : null}
    </main>
  );
}

function HandoffSession({ sessionId, accessToken }: { sessionId: string; accessToken: string }) {
  const load = useAction(api.tasks.handoff.load);
  const resume = useAction(api.tasks.handoff.resume);
  const decline = useAction(api.tasks.handoff.decline);
  const [page, setPage] = useState<HandoffPage | null>(null);
  const [pending, setPending] = useState<"load" | "resume" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const request = useCallback(
    async (operation: "load" | "resume" | "decline") => {
      const id = ++requestId.current;
      setPending(operation);
      setError(null);
      if (operation !== "load") setPage(null);
      try {
        const page = await { load, resume, decline }[operation]({ sessionId, accessToken });
        if (id !== requestId.current) return;
        setPage(page);
      } catch (caught) {
        if (id === requestId.current) {
          setPage(null);
          setError(requestError(caught));
        }
      } finally {
        if (id === requestId.current) setPending(null);
      }
    },
    [accessToken, decline, load, resume, sessionId],
  );

  useEffect(() => {
    return () => {
      requestId.current += 1;
    };
  }, [request]);

  useEffect(() => {
    if (pending || error) return;
    if (!page) {
      void request("load");
      return;
    }
    if (page.status !== "waiting" && page.status !== "checking") return;
    const timer = window.setTimeout(() => {
      void request("load");
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [error, pending, request, page]);

  return (
    <section aria-busy={pending !== null} className="flex flex-col gap-3 sm:gap-5">
      {error ? (
        <p role="alert" className="px-3 whitespace-pre-wrap break-words text-destructive sm:px-0">
          {error}
        </p>
      ) : null}
      {error ? (
        <Button
          variant="outline"
          className="mx-3 self-start sm:mx-0"
          onClick={() => {
            void request("load");
          }}
        >
          Reload handoff
        </Button>
      ) : null}
      {pending === "resume" || pending === "decline" ? (
        <p role="status" className="px-3 sm:px-0">
          {pending === "resume" ? "Checking whether Scout can continue…" : "Stopping Scout…"}
        </p>
      ) : null}
      {page ? (
        <HandoffContent
          page={page}
          onResume={() => {
            void request("resume");
          }}
          onDecline={() => {
            void request("decline");
          }}
        />
      ) : null}
    </section>
  );
}

function HandoffContent({
  page,
  onResume,
  onDecline,
}: {
  page: HandoffPage;
  onResume: () => void;
  onDecline: () => void;
}) {
  switch (page.status) {
    case "invalid":
      return (
        <p role="alert" className="px-3 sm:px-0">
          This handoff link is invalid or no longer available. Open the latest link from your email.
        </p>
      );
    case "expired":
      return (
        <p role="status" className="px-3 sm:px-0">
          This handoff has expired. Browser control is no longer available.
        </p>
      );
    case "stopped":
      return (
        <p role="status" className="px-3 sm:px-0">
          This task has stopped. Browser control is no longer available.
        </p>
      );
    case "declined":
      return (
        <p role="status" className="px-3 sm:px-0">
          Scout has stopped because you couldn't complete this step. You can close this tab.
        </p>
      );
    case "failed":
      return (
        <div role="alert" className="px-3 text-destructive sm:px-0">
          <p className="whitespace-pre-wrap break-words">
            {page.diagnostic?.message ?? page.error}
          </p>
          {page.diagnostic ? (
            <details className="mt-2">
              <summary className="w-fit cursor-pointer rounded text-sm focus-visible:ring-2 focus-visible:ring-ring">
                Details
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap wrap-anywhere select-text">
                {JSON.stringify({ ...page.diagnostic, error: page.error }, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      );
    case "continued":
      return (
        <p role="status" className="px-3 sm:px-0">
          {page.scoutName} has continued. You can close this tab.
        </p>
      );
    case "checking":
    case "waiting":
      return (
        <>
          <section className="space-y-3 px-3 sm:px-0">
            <header className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h1 className="text-2xl font-semibold tracking-tight">
                {page.scoutName} needs your help
              </h1>
              {page.status === "waiting" ? <HandoffCountdown expiresAt={page.expiresAt} /> : null}
            </header>
            {page.status === "waiting" ? (
              <p className="whitespace-pre-wrap break-words">{page.message}</p>
            ) : null}
          </section>
          {page.status === "checking" ? (
            <p role="status" className="px-3 sm:px-0">
              Checking whether Scout can continue…
            </p>
          ) : (
            <>
              {page.checkMessage ? (
                <p role="alert" className="px-3 whitespace-pre-wrap break-words sm:px-0">
                  {page.checkMessage}
                </p>
              ) : null}
              <div className="flex flex-col gap-2 px-3 sm:flex-row sm:px-0">
                <Button size="lg" onClick={onResume}>
                  Resume Scout
                </Button>
                <Button size="lg" variant="outline" onClick={onDecline}>
                  I couldn't complete this
                </Button>
              </div>
              <iframe
                title="Scout browser"
                src={page.interactiveLiveViewUrl}
                referrerPolicy="no-referrer"
                className="h-[65dvh] min-h-80 w-full border-y bg-card sm:rounded-lg sm:border"
              />
            </>
          )}
        </>
      );
    default: {
      const unreachable: never = page;
      return unreachable;
    }
  }
}

function requestError(caught: unknown) {
  if (caught instanceof ConvexError && typeof caught.data === "string") return caught.data;
  if (caught instanceof Error) return caught.message;
  return typeof caught === "string" ? caught : "The request failed.";
}

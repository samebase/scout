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

export function HumanHandoffPage({ sessionId }: { sessionId: string }) {
  const [access, setAccess] = useState<Access>({ status: "loading" });
  useEffect(() => {
    if (!humanHandoffIsTopLevel(window)) {
      setAccess({ status: "unavailable", message: "Open the email link in its own browser tab." });
      return;
    }
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
  }, [sessionId]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <header>
        <p className="text-sm font-semibold text-muted-foreground">Scout</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Help Scout continue</h1>
      </header>
      {access.status === "loading" ? <p role="status">Opening handoff…</p> : null}
      {access.status === "unavailable" ? <p role="alert">{access.message}</p> : null}
      {access.status === "ready" ? (
        <HandoffSession sessionId={sessionId} accessToken={access.accessToken} />
      ) : null}
    </main>
  );
}

function HandoffSession({ sessionId, accessToken }: { sessionId: string; accessToken: string }) {
  const load = useAction(api.tasks.handoff.load);
  const resume = useAction(api.tasks.handoff.resume);
  const [snapshot, setSnapshot] = useState<{ page: HandoffPage; requestedAt: number } | null>(null);
  const [pending, setPending] = useState<"load" | "resume" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const request = useCallback(
    async (operation: "load" | "resume") => {
      const id = ++requestId.current;
      const requestedAt = performance.now();
      setPending(operation);
      setError(null);
      if (operation === "resume") setSnapshot(null);
      try {
        const page = await (operation === "load" ? load : resume)({ sessionId, accessToken });
        if (id !== requestId.current) return;
        const overdue =
          page.status === "waiting" &&
          page.expiresAt - page.serverNow <= performance.now() - requestedAt;
        setSnapshot(overdue ? null : { page, requestedAt });
      } catch (caught) {
        if (id === requestId.current) {
          setSnapshot(null);
          setError(requestError(caught));
        }
      } finally {
        if (id === requestId.current) setPending(null);
      }
    },
    [accessToken, load, resume, sessionId],
  );

  useEffect(() => {
    return () => {
      requestId.current += 1;
    };
  }, [request]);

  useEffect(() => {
    if (!snapshot || snapshot.page.status !== "waiting") return;
    const { page, requestedAt } = snapshot;
    const remaining = page.expiresAt - page.serverNow - (performance.now() - requestedAt);
    const timer = window.setTimeout(
      () => {
        setSnapshot((current) => (current === snapshot ? null : current));
      },
      Math.max(0, remaining),
    );
    return () => window.clearTimeout(timer);
  }, [snapshot]);

  useEffect(() => {
    if (pending || error) return;
    if (!snapshot) {
      void request("load");
      return;
    }
    if (snapshot.page.status !== "waiting" && snapshot.page.status !== "checking") return;
    const timer = window.setTimeout(() => {
      void request("load");
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [error, pending, request, snapshot]);

  const page = snapshot?.page;
  return (
    <>
      {error ? (
        <p role="alert" className="whitespace-pre-wrap break-words text-destructive">
          {error}
        </p>
      ) : null}
      {error ? (
        <Button
          variant="outline"
          className="self-start"
          onClick={() => {
            void request("load");
          }}
        >
          Reload handoff
        </Button>
      ) : null}
      {!page ? (
        !error && (
          <p role="status">
            {pending === "resume"
              ? "Checking whether Scout can continue…"
              : "Loading handoff status…"}
          </p>
        )
      ) : (
        <HandoffContent
          page={page}
          onResume={() => {
            void request("resume");
          }}
        />
      )}
    </>
  );
}

function HandoffContent({ page, onResume }: { page: HandoffPage; onResume: () => void }) {
  switch (page.status) {
    case "invalid":
      return (
        <p role="alert">
          This handoff link is invalid or no longer available. Open the latest link from your email.
        </p>
      );
    case "expired":
      return <p role="status">This handoff has expired. Browser control is no longer available.</p>;
    case "stopped":
      return <p role="status">This task has stopped. Browser control is no longer available.</p>;
    case "failed":
      return (
        <p role="alert" className="whitespace-pre-wrap break-words text-destructive">
          {page.error}
        </p>
      );
    case "continued":
      return <p role="status">{page.scoutName} has continued. You can close this tab.</p>;
    case "checking":
    case "waiting":
      return (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-medium">{page.scoutName} needs your help</h2>
            {page.status === "waiting" ? (
              <p className="whitespace-pre-wrap break-words">{page.message}</p>
            ) : null}
            {page.status === "waiting" ? (
              <p className="text-sm text-muted-foreground">
                Available until{" "}
                <time dateTime={new Date(page.expiresAt).toISOString()}>
                  {new Date(page.expiresAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>{" "}
                · your local time
              </p>
            ) : null}
          </section>
          {page.status === "checking" ? (
            <p role="status">Checking whether Scout can continue…</p>
          ) : (
            <>
              {page.checkMessage ? (
                <p role="alert" className="whitespace-pre-wrap break-words">
                  {page.checkMessage}
                </p>
              ) : null}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Complete the step in the browser, then resume Scout.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" asChild>
                    <a
                      href={page.interactiveLiveViewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                    >
                      Open browser
                    </a>
                  </Button>
                  <Button onClick={onResume}>Resume Scout</Button>
                </div>
              </div>
              <iframe
                title="Scout browser"
                src={page.interactiveLiveViewUrl}
                referrerPolicy="no-referrer"
                className="h-[65dvh] min-h-80 w-full rounded-lg border bg-card"
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

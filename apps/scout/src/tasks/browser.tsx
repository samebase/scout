import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { ExternalLinkIcon } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { BrowserReplay } from "#components/browser-replay";
import { Button, buttonVariants } from "#components/ui/button";
import type { LabSearch, BrowserSession, Session } from "./model";

export function OpenHandoffBrowserButton({
  sessionId,
  label,
  className,
  disabled,
}: {
  sessionId: Session["_id"];
  label: string;
  className: string;
  disabled: boolean;
}) {
  const openBrowser = useMutation(api.tasks.sessions.openHandoffBrowser);
  const opening = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (disabled || opening.current) return;
    opening.current = true;
    setPending(true);
    setError(null);
    let tab: Window | null = null;
    try {
      tab = window.open("about:blank", "_blank");
      if (!tab) throw new Error("Allow pop-ups to open the browser.");
      tab.opener = null;
      const result = await openBrowser({ sessionId });
      if (result) tab.location.replace(result.url);
      else tab.close();
    } catch (caught) {
      tab?.close();
      setError(
        caught instanceof ConvexError && typeof caught.data === "string"
          ? caught.data
          : caught instanceof Error
            ? caught.message
            : String(caught),
      );
    } finally {
      opening.current = false;
      setPending(false);
    }
  }

  return (
    <div className="min-w-0 space-y-2">
      <button
        type="button"
        disabled={disabled || pending}
        className={className}
        onClick={() => void open()}
      >
        {label} <ExternalLinkIcon size={15} aria-hidden="true" />
      </button>
      {error && (
        <p role="alert" className="text-sm whitespace-pre-wrap wrap-anywhere text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function BrowserPanel({
  sessionId,
  search,
}: {
  sessionId: Session["_id"];
  search: LabSearch;
}) {
  const browsers = useQuery(api.tasks.sessions.listBrowsers, { sessionId });
  const navigate = useNavigate({ from: "/lab" });
  const selected = browsers?.find((browser) => browser._id === search.browser) ?? browsers?.at(-1);

  return (
    <PaneFrame
      header={
        browsers && browsers.length > 1 && selected ? (
          <select
            aria-label="Browser session"
            value={selected._id}
            onChange={(event) => {
              const browser = browsers.find((browser) => browser._id === event.currentTarget.value);
              if (browser)
                void navigate({
                  resetScroll: false,
                  search: (previous) => ({
                    ...previous,
                    browser: browser._id,
                    replayPage: undefined,
                  }),
                });
            }}
            className="h-full w-full bg-background px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {browsers.map((browser) => (
              <option key={browser._id} value={browser._id}>
                Session {browser.sequence}
                {browser.lifecycle.kind === "active"
                  ? " · Live"
                  : browser.lifecycle.kind === "closing"
                    ? " · Closing"
                    : ""}
              </option>
            ))}
          </select>
        ) : undefined
      }
      content={
        selected ? (
          <BrowserView
            key={selected._id}
            sessionId={sessionId}
            browser={selected}
            search={search}
          />
        ) : browsers === undefined ? (
          <div className="min-h-full" aria-busy="true" />
        ) : (
          <p
            role="status"
            className="grid min-h-full place-items-center p-6 text-center text-sm text-muted-foreground"
          >
            No browser session yet.
          </p>
        )
      }
    />
  );
}

function BrowserView({
  sessionId,
  browser,
  search,
}: {
  sessionId: Session["_id"];
  browser: BrowserSession;
  search: LabSearch;
}) {
  const navigate = useNavigate({ from: "/lab" });
  switch (browser.lifecycle.kind) {
    case "closed":
      return (
        <BrowserReplay
          sessionId={browser._id}
          mode="inspector"
          selectedPageId={search.replayPage ?? null}
          onSelectPage={(replayPage) =>
            void navigate({
              resetScroll: false,
              search: (previous) => ({ ...previous, replayPage: replayPage ?? undefined }),
            })
          }
        />
      );
    case "closing":
      return (
        <p
          role="status"
          className="grid min-h-full place-items-center p-6 text-sm text-muted-foreground"
        >
          Closing browser…
        </p>
      );
    case "active": {
      return (
        <section className="chat-browser" aria-label="Live browser">
          <div className="chat-browser-bar">
            <span className="truncate text-xs font-medium">Live · Session {browser.sequence}</span>
            {browser.interactiveLiveViewUrl ? (
              <OpenHandoffBrowserButton
                sessionId={sessionId}
                label="Open browser"
                className={buttonVariants({ size: "xs", variant: "ghost" })}
                disabled={false}
              />
            ) : browser.liveViewUrl ? (
              <Button asChild size="xs" variant="ghost">
                <a
                  href={browser.liveViewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open browser"
                >
                  Open <ExternalLinkIcon data-icon="inline-end" />
                </a>
              </Button>
            ) : null}
          </div>
          {browser.liveViewUrl ? (
            <>
              <div className="chat-browser-narrow">
                {browser.interactiveLiveViewUrl ? (
                  <OpenHandoffBrowserButton
                    sessionId={sessionId}
                    label="Open live browser"
                    className="inline-flex items-center gap-1 underline"
                    disabled={false}
                  />
                ) : (
                  <a href={browser.liveViewUrl} target="_blank" rel="noopener noreferrer">
                    Open live browser
                  </a>
                )}
              </div>
              <iframe
                src={browser.liveViewUrl}
                title={`Live browser session ${browser.sequence}`}
                referrerPolicy="no-referrer"
                sandbox="allow-same-origin allow-scripts"
                className="chat-browser-frame"
              />
            </>
          ) : (
            <div className="flex-1" aria-busy="true" />
          )}
        </section>
      );
    }
    default: {
      const exhaustive: never = browser.lifecycle;
      return exhaustive;
    }
  }
}

import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ExternalLinkIcon } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { BrowserReplay } from "#components/browser-replay";
import { Button } from "#components/ui/button";
import type { AgentsSearch, BrowserSession, Session } from "./model";

export function BrowserPanel({
  sessionId,
  search,
}: {
  sessionId: Session["_id"];
  search: AgentsSearch;
}) {
  const browsers = useQuery(api.tasks.sessions.listBrowsers, { sessionId });
  const navigate = useNavigate({ from: "/agents" });
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
          <BrowserView key={selected._id} browser={selected} search={search} />
        ) : (
          <p
            role="status"
            className="grid min-h-full place-items-center p-6 text-center text-sm text-muted-foreground"
          >
            {browsers === undefined ? "Loading browser…" : "No browser session yet."}
          </p>
        )
      }
    />
  );
}

function BrowserView({ browser, search }: { browser: BrowserSession; search: AgentsSearch }) {
  const navigate = useNavigate({ from: "/agents" });
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
      const openUrl = browser.interactiveLiveViewUrl ?? browser.liveViewUrl;
      return (
        <section className="chat-browser" aria-label="Live browser">
          <div className="chat-browser-bar">
            <span className="truncate text-xs font-medium">Live · Session {browser.sequence}</span>
            {openUrl && (
              <Button asChild size="xs" variant="ghost">
                <a
                  href={openUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open browser"
                >
                  Open <ExternalLinkIcon data-icon="inline-end" />
                </a>
              </Button>
            )}
          </div>
          {browser.liveViewUrl ? (
            <>
              <div className="chat-browser-narrow">
                <a href={openUrl ?? browser.liveViewUrl} target="_blank" rel="noopener noreferrer">
                  Open live browser
                </a>
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
            <p
              role="status"
              className="grid flex-1 place-items-center p-6 text-sm text-muted-foreground"
            >
              Connecting to live browser…
            </p>
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

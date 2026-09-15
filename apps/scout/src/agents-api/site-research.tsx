import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useState } from "react";
import Markdown from "react-markdown";
import { api } from "../../convex/_generated/api";
import { Button } from "#components/ui/button";
import type { Session, SiteResearch } from "./model";

export function SiteResearchView({
  session,
  research,
}: {
  session: Session;
  research: SiteResearch | null | undefined;
}) {
  const stop = useMutation(api.agentsApi.sessions.stop);
  const [error, setError] = useState<string | null>(null);
  return (
    <PaneFrame
      content={
        <section className="mx-auto max-w-3xl space-y-5 p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Site research</h2>
            {session.canControl &&
              session.state.kind === "starting" &&
              research?.state.kind === "running" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void stop({ sessionId: session._id }).catch((cause) =>
                      setError(cause instanceof Error ? cause.message : "Could not stop session"),
                    )
                  }
                >
                  Stop
                </Button>
              )}
          </div>
          {research?.site && (
            <Link to="/sites/$site" params={{ site: research.site }} className="text-sm underline">
              {research.site}
            </Link>
          )}
          {!research && (
            <p role="status">
              {research === undefined ? "Opening research…" : "No research for this session."}
            </p>
          )}
          {research?.state.kind === "running" && (
            <p role="status" className="text-sm text-muted-foreground">
              {session.state.kind === "stopped" ? "Stopping…" : "Gathering site information…"}
            </p>
          )}
          {research?.state.kind === "completed" && (
            <>
              <div className="space-y-4 break-words text-sm leading-6 [&_h1]:font-semibold [&_h2]:font-semibold [&_li]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5">
                <Markdown
                  skipHtml
                  disallowedElements={["img"]}
                  components={{
                    a: ({ href, children }) =>
                      href?.startsWith("/workspace/") ? (
                        <Link
                          to="/agents"
                          search={{
                            session: session._id,
                            step: "chat",
                            view: "workspace",
                            file: href,
                          }}
                          className="underline"
                        >
                          {children}
                        </Link>
                      ) : (
                        <a href={href} target="_blank" rel="noreferrer" className="underline">
                          {children}
                        </a>
                      ),
                  }}
                >
                  {research.state.brief}
                </Markdown>
              </div>
              <Link
                to="/agents"
                search={{
                  session: session._id,
                  step: "chat",
                  view: "workspace",
                  file: research.state.briefPath,
                }}
                className="text-sm underline"
              >
                Open briefing file
              </Link>
            </>
          )}
          {research?.state.kind === "failed" && (
            <p role="alert" className="text-sm text-destructive">
              {research.state.error}
            </p>
          )}
          {research?.state.kind === "skipped" && (
            <p className="text-sm text-muted-foreground">{research.state.reason}</p>
          )}
          {research?.state.kind === "cancelled" && (
            <p className="text-sm text-muted-foreground">Cancelled</p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </section>
      }
    />
  );
}

export function SiteResearchInspector({ research }: { research: SiteResearch | null | undefined }) {
  if (!research) return null;
  return (
    <PaneFrame
      header={<h2 className="border-b px-4 py-3 text-sm font-medium">Research details</h2>}
      content={
        <div className="space-y-5 p-4 text-sm">
          <dl className="grid gap-y-1 break-words [&_dd]:mb-2">
            <dt className="text-muted-foreground">Model</dt>
            <dd>{research.model}</dd>
            {research.state.kind !== "running" && (
              <>
                <dt className="text-muted-foreground">Duration</dt>
                <dd>{((research.state.finishedAt - research._creationTime) / 1000).toFixed(1)}s</dd>
              </>
            )}
            <dt className="text-muted-foreground">Model cost</dt>
            <dd>
              {research.modelCost === null
                ? "Not reported"
                : `$${research.modelCost.toFixed(6)} estimated`}
            </dd>
          </dl>
          {research.calls.map((call) => (
            <div key={call.name} className="space-y-2 border-t pt-3">
              <div className="flex justify-between gap-2">
                <span className="font-medium">{call.name}</span>
                <span>{((call.finishedAt - call.startedAt) / 1000).toFixed(1)}s</span>
              </div>
              {call.usage && (
                <p className="text-xs text-muted-foreground">
                  {call.usage.inputTokens} input · {call.usage.outputTokens} output tokens
                </p>
              )}
              {!call.usage && (
                <p className="text-xs text-muted-foreground">
                  {call.credits === null
                    ? "Credits not reported"
                    : `${call.credits} Firecrawl credits`}
                </p>
              )}
              <div className="flex gap-3">
                <Link
                  to="/agents"
                  search={{
                    session: research.sessionId,
                    step: "chat",
                    view: "workspace",
                    file: call.requestPath,
                  }}
                  className="underline"
                >
                  Request
                </Link>
                {call.responsePath && (
                  <Link
                    to="/agents"
                    search={{
                      session: research.sessionId,
                      step: "chat",
                      view: "workspace",
                      file: call.responsePath,
                    }}
                    className="underline"
                  >
                    Response
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      }
    />
  );
}

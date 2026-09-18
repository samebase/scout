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
  const stop = useMutation(api.tasks.sessions.stop);
  const [error, setError] = useState<string | null>(null);
  return (
    <PaneFrame
      content={
        <section className="mx-auto max-w-3xl space-y-5 p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Site research</h2>
            {session.canControl &&
              session.state.kind === "starting" &&
              (research?.state.kind === "running" || research?.state.kind === "waiting") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void stop({ sessionId: session._id }).catch((cause) =>
                      setError(cause instanceof Error ? cause.message : "Could not stop task"),
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
              {research === undefined ? "Opening research…" : "No research for this task."}
            </p>
          )}
          {research?.state.kind === "running" && (
            <p role="status" className="text-sm text-muted-foreground">
              {session.state.kind === "stopped" ? "Stopping…" : "Gathering site information…"}
            </p>
          )}
          {research?.state.kind === "waiting" && (
            <p role="status" className="text-sm text-muted-foreground">
              {session.state.kind === "stopped" ? "Stopping…" : "Waiting for site research…"}
            </p>
          )}
          {research?.state.kind === "completed" && (
            <>
              {research.state.source?.reused && (
                <p className="text-sm text-muted-foreground">
                  Reused research from{" "}
                  <time dateTime={new Date(research.state.source.researchedAt).toISOString()}>
                    {new Date(research.state.source.researchedAt).toLocaleDateString(undefined, {
                      dateStyle: "medium",
                    })}
                  </time>
                </p>
              )}
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
                            step: "site_research",
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
                  step: "site_research",
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

export function SiteResearchInspector({
  research,
  sessionId,
}: {
  research: SiteResearch | null | undefined;
  sessionId: Session["_id"];
}) {
  if (!research) return null;
  return (
    <PaneFrame
      header={<h2 className="border-b px-4 py-3 text-sm font-medium">Research details</h2>}
      content={
        <div className="space-y-5 p-4 text-sm">
          <dl className="grid gap-y-1 break-words [&_dd]:mb-2">
            <dt className="text-muted-foreground">Model</dt>
            <dd>{research.model}</dd>
            {research.state.kind !== "running" && research.state.kind !== "waiting" && (
              <>
                <dt className="text-muted-foreground">Duration</dt>
                <dd>{((research.state.finishedAt - research._creationTime) / 1000).toFixed(1)}s</dd>
              </>
            )}
            <dt className="text-muted-foreground">Firecrawl credits</dt>
            <dd>{research.credits === null ? "Not reported" : research.credits}</dd>
            <dt className="text-muted-foreground">Credit limit</dt>
            <dd>{research.maxCredits}</dd>
            {research.jobId && (
              <>
                <dt className="text-muted-foreground">Job ID</dt>
                <dd className="break-all">{research.jobId}</dd>
              </>
            )}
          </dl>
          <div className="flex flex-wrap gap-3">
            {research.requestPath && (
              <Link
                to="/agents"
                search={{
                  session: sessionId,
                  step: "site_research",
                  view: "workspace",
                  file: research.requestPath,
                }}
                className="underline"
              >
                Request
              </Link>
            )}
            {research.responsePath && (
              <Link
                to="/agents"
                search={{
                  session: sessionId,
                  step: "site_research",
                  view: "workspace",
                  file: research.responsePath,
                }}
                className="underline"
              >
                Response
              </Link>
            )}
            {research.state.kind === "completed" && (
              <Link
                to="/agents"
                search={{ session: sessionId, step: "site_research" }}
                className="underline"
              >
                Brief
              </Link>
            )}
          </div>
        </div>
      }
    />
  );
}

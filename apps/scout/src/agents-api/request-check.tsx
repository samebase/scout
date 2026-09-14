import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { Button } from "#components/ui/button";
import type { RequestCheck, Session } from "./model";

export function RequestCheckView({
  session,
  check,
}: {
  session: Session;
  check: RequestCheck | null | undefined;
}) {
  const stop = useMutation(api.agentsApi.sessions.stop);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function stopCheck() {
    if (stopping) return;
    setStopping(true);
    setError(null);
    try {
      await stop({ sessionId: session._id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not stop session.");
    } finally {
      setStopping(false);
    }
  }
  if (!check)
    return (
      <PaneFrame
        content={
          <p
            role={check === undefined ? "status" : undefined}
            className="p-6 text-sm text-muted-foreground"
          >
            {check === undefined ? "Opening check…" : "Check not found."}
          </p>
        }
      />
    );
  const { state } = check;
  return (
    <PaneFrame
      content={
        <section className="mx-auto w-full max-w-3xl space-y-6 p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              {check.kind === "initial" ? "Request check" : "Resume check"}
            </h2>
            {session.canControl &&
              session.active &&
              session.state.kind !== "stopped" &&
              (state.kind === "pending" || state.kind === "running") && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={stopping}
                  onClick={() => void stopCheck()}
                >
                  Stop
                </Button>
              )}
          </div>
          <p className="whitespace-pre-wrap break-words rounded-lg bg-muted p-4 text-sm">
            {check.prompt}
          </p>
          {check.kind === "resume" && (
            <>
              <div className="space-y-2 text-sm">
                <h3 className="font-medium">Handoff</h3>
                <p className="whitespace-pre-wrap break-words">{check.handoff.message}</p>
              </div>
              <div className="space-y-3 text-sm">
                <h3 className="font-medium">Browser evidence</h3>
                {check.evidence === null ? (
                  <p className="text-muted-foreground">Not captured</p>
                ) : (
                  <>
                    <time
                      className="text-xs text-muted-foreground"
                      dateTime={new Date(check.evidence.capturedAt).toISOString()}
                    >
                      {new Date(check.evidence.capturedAt).toLocaleString()}
                    </time>
                    {check.evidence.pages.length === 0 && (
                      <p className="text-muted-foreground">No open pages</p>
                    )}
                    {check.evidence.pages.map((page) => (
                      <details key={page.tabId} className="border-t pt-3">
                        <summary className="cursor-pointer break-words font-medium">
                          {page.title || page.url}
                        </summary>
                        <p className="mt-2 break-words text-xs text-muted-foreground">{page.url}</p>
                        <pre className="mt-3 whitespace-pre-wrap break-words text-xs">
                          {page.content}
                        </pre>
                      </details>
                    ))}
                  </>
                )}
              </div>
            </>
          )}
          {(state.kind === "pending" || state.kind === "running") && (
            <p role="status" className="text-sm text-muted-foreground">
              {session.state.kind === "stopped"
                ? "Stopped"
                : check.kind === "initial"
                  ? "Checking request…"
                  : "Checking browser…"}
            </p>
          )}
          {state.kind === "completed" && (
            <dl className="space-y-4 text-sm">
              {state.result.kind === "initial" && (
                <div>
                  <dt className="text-muted-foreground">Title</dt>
                  <dd className="mt-1 font-medium">{state.result.title}</dd>
                </div>
              )}
              <div>
                <dt className="font-medium">
                  {state.result.decision.kind === "approved" ? "Approved" : "Declined"}
                </dt>
                {state.result.decision.kind === "rejected" && (
                  <dd className="mt-1">{state.result.decision.reason}</dd>
                )}
              </div>
            </dl>
          )}
          {state.kind === "failed" && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          {state.kind === "cancelled" && <p className="text-sm text-muted-foreground">Cancelled</p>}
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

export function RequestCheckInspector({ check }: { check: RequestCheck | null | undefined }) {
  if (!check) return null;
  const { state } = check;
  const finished = state.kind === "completed" || state.kind === "failed" ? state : null;
  const call = finished?.call;
  const request = state.kind === "running" ? state.request : call?.request;
  return (
    <PaneFrame
      header={<h2 className="border-b px-4 py-3 text-sm font-medium">Call details</h2>}
      content={
        <div className="space-y-5 p-4 text-sm">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">Model</dt>
            <dd className="break-words">{check.model}</dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd>
              <time dateTime={new Date(check._creationTime).toISOString()}>
                {new Date(check._creationTime).toLocaleString()}
              </time>
            </dd>
            {finished && (
              <>
                <dt className="text-muted-foreground">Duration</dt>
                <dd>{((finished.finishedAt - check._creationTime) / 1000).toFixed(1)}s</dd>
              </>
            )}
            <dt className="text-muted-foreground">Cost</dt>
            <dd>{check.cost === null ? "Not reported" : `$${check.cost.toFixed(6)} estimated`}</dd>
            {call?.usage && (
              <>
                <dt className="text-muted-foreground">Input tokens</dt>
                <dd>{call.usage.inputTokens}</dd>
                <dt className="text-muted-foreground">Output tokens</dt>
                <dd>{call.usage.outputTokens}</dd>
              </>
            )}
          </dl>
          {request && <CallData title="Request" value={request} />}
          {call?.response != null && <CallData title="Response" value={call.response} />}
        </div>
      }
    />
  );
}

function CallData({ title, value }: { title: string; value: string }) {
  let formatted = value;
  try {
    formatted = JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    // Failed provider calls may store a plain-text response.
  }
  return (
    <details className="border-t pt-3">
      <summary className="cursor-pointer font-medium">{title}</summary>
      <pre className="mt-3 whitespace-pre-wrap break-words text-xs">{formatted}</pre>
    </details>
  );
}

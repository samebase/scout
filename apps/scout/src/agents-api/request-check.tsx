import { PaneFrame } from "@samebase/sidebars/PaneFrame";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { Button } from "#components/ui/button";
import type { Session } from "./model";

export function RequestCheckView({ session }: { session: Session }) {
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
  const check = session.requestCheck;
  if (!check) return null;
  const { state } = check;
  return (
    <PaneFrame
      content={
        <section className="mx-auto w-full max-w-3xl space-y-6 p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Request check</h2>
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
          {(state.kind === "pending" || state.kind === "running") && (
            <p role="status" className="text-sm text-muted-foreground">
              {session.state.kind === "stopped" ? "Stopped" : "Checking request…"}
            </p>
          )}
          {state.kind === "completed" && (
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Title</dt>
                <dd className="mt-1 font-medium">{state.result.title}</dd>
              </div>
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

export function RequestCheckInspector({ session }: { session: Session }) {
  const check = session.requestCheck;
  if (!check) return null;
  const { state } = check;
  const finished = state.kind === "completed" || state.kind === "failed" ? state : null;
  const request = state.kind === "running" ? state.request : finished?.request;
  return (
    <PaneFrame
      header={<h2 className="border-b px-4 py-3 text-sm font-medium">Call details</h2>}
      content={
        <div className="space-y-5 p-4 text-sm">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">Model</dt>
            <dd className="break-words">{check.model}</dd>
            {finished && (
              <>
                <dt className="text-muted-foreground">Duration</dt>
                <dd>{((finished.finishedAt - finished.startedAt) / 1000).toFixed(1)}s</dd>
              </>
            )}
            <dt className="text-muted-foreground">Cost</dt>
            <dd>
              {session.requestCheckCost === null
                ? "Not reported"
                : `$${session.requestCheckCost.toFixed(6)} estimated`}
            </dd>
            {finished?.usage && (
              <>
                <dt className="text-muted-foreground">Input tokens</dt>
                <dd>{finished.usage.inputTokens}</dd>
                <dt className="text-muted-foreground">Output tokens</dt>
                <dd>{finished.usage.outputTokens}</dd>
              </>
            )}
          </dl>
          {request && <CallData title="Request" value={request} />}
          {finished?.response && <CallData title="Response" value={finished.response} />}
        </div>
      }
    />
  );
}

function CallData({ title, value }: { title: string; value: string }) {
  return (
    <details className="border-t pt-3">
      <summary className="cursor-pointer font-medium">{title}</summary>
      <pre className="mt-3 whitespace-pre-wrap break-words text-xs">
        {JSON.stringify(JSON.parse(value), null, 2)}
      </pre>
    </details>
  );
}

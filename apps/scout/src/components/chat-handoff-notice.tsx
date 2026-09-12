import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { Button } from "#components/ui/button";

type ChatHandoff = NonNullable<FunctionReturnType<typeof api.humanHandoffs.forSession>>;
const handoffTime = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

function handoffOutcome(handoff: ChatHandoff) {
  switch (handoff.status) {
    case "available":
    case "active":
      return "Waiting for your help";
    case "continued":
      return "Handoff complete. Scout is resuming…";
    case "resumed":
      return "Handoff complete. Scout resumed.";
    case "stopped":
      return "Handoff canceled.";
    case "expired":
      return "Handoff expired.";
    case "failed":
      switch (handoff.failure) {
        case "delivery_failed":
          return "Scout could not deliver the private handoff link.";
        case "browser_ended":
          return "The browser ended before the handoff was completed.";
        case "scout_failed":
          return "Scout stopped before the handoff was completed.";
      }
  }
}

export function ChatHandoffNotice({
  handoff,
  browserClosed,
  canCancel,
  onCancel,
}: {
  handoff: ChatHandoff;
  browserClosed: boolean;
  canCancel: boolean;
  onCancel: () => void;
}) {
  const waiting = handoff.status === "available" || handoff.status === "active";
  const ended =
    handoff.status === "expired" || handoff.status === "stopped" || handoff.status === "failed";
  return (
    <div
      role={handoff.status === "failed" ? "alert" : "status"}
      className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 px-4 py-3"
    >
      <div
        role="region"
        aria-label="Handoff details"
        tabIndex={0}
        className="max-h-[20dvh] min-w-0 space-y-1 overflow-y-auto overscroll-y-contain text-sm [overflow-wrap:anywhere]"
      >
        <p className="font-medium">{handoffOutcome(handoff)}</p>
        {waiting ? (
          <>
            <p>{handoff.reason}</p>
            <p className="text-muted-foreground text-xs">
              Scout is paused. {handoff.status === "available" ? "Open" : "Finish"} by{" "}
              <time dateTime={new Date(handoff.expiresAt).toISOString()}>
                {handoffTime.format(handoff.expiresAt)}
              </time>
              . The browser closes when the handoff expires or you cancel.
            </p>
          </>
        ) : ended ? (
          <p className="text-muted-foreground text-xs">
            {browserClosed
              ? "The browser is closed. Send a new message to continue."
              : "Closing the browser…"}
          </p>
        ) : null}
      </div>
      {waiting || handoff.status === "continued" ? (
        <div className="flex max-w-full flex-wrap gap-2">
          {waiting ? (
            <Button asChild size="sm" variant="outline">
              <Link
                to="/handoff/$handoffId"
                params={{ handoffId: handoff.handoffId }}
                aria-label="Open browser handoff"
              >
                Open browser
              </Link>
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canCancel}
            onClick={onCancel}
            aria-label="Cancel handoff"
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}

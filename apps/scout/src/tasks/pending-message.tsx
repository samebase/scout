import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import { Button } from "../components/ui/button";

export function PendingTaskMessage({
  pendingMessage,
  active,
  canRetry,
  onRetry,
  retrying,
}: {
  pendingMessage: NonNullable<
    FunctionReturnType<typeof api.tasks.sessions.controls>
  >["pendingMessage"];
  active: boolean;
  canRetry: boolean;
  onRetry: () => void;
  retrying: boolean;
}) {
  if (!pendingMessage) return null;
  const status = active
    ? "Sending…"
    : {
        queued: "Your message wasn’t sent.",
        submitting:
          "We couldn’t confirm whether your message was delivered. Check the conversation before sending it again.",
      }[pendingMessage.status];

  return (
    <div role="group" aria-label="Pending message" className="mb-3 space-y-2">
      <p className="ml-auto max-h-40 max-w-[95%] overflow-y-auto rounded-xl bg-secondary px-5 py-3.5 text-[15px] whitespace-pre-wrap [overflow-wrap:anywhere]">
        {pendingMessage.message}
      </p>
      <p role={active ? "status" : "alert"} className="text-sm text-muted-foreground">
        {status}
      </p>
      {pendingMessage.status === "queued" && !active && canRetry && (
        <Button type="button" variant="outline" disabled={retrying} onClick={onRetry}>
          Retry message
        </Button>
      )}
    </div>
  );
}

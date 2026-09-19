import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";

type Controls = FunctionReturnType<typeof api.tasks.sessions.controls>;
const labels = {
  approved: "Resume check passed",
  rejected: "Resume blocked",
  failed: "Resume check failed",
};

export function TaskResumeHistory({
  attempts,
  state,
}: {
  attempts: Controls["resumeAttempts"];
  state: Controls["state"];
}) {
  const latest = attempts[0];
  if (!latest) return null;
  return (
    <details
      key={latest.id}
      open={
        latest.outcome.kind !== "approved" && (state.kind === "stopped" || state.kind === "failed")
      }
      className="shrink-0 border-b px-4 py-3 text-sm"
    >
      <summary className="w-fit cursor-pointer rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Resume attempts ({attempts.length}) · {labels[latest.outcome.kind]}
      </summary>
      <ol className="mt-3 max-h-48 space-y-3 overflow-y-auto" aria-label="Resume attempts">
        {attempts.map((attempt) => (
          <li key={attempt.id} className="space-y-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{labels[attempt.outcome.kind]}</span>
              <time
                dateTime={new Date(attempt.finishedAt).toISOString()}
                className="text-xs text-muted-foreground"
              >
                {new Date(attempt.finishedAt).toLocaleString()}
              </time>
            </div>
            {attempt.outcome.kind !== "approved" && (
              <p className="whitespace-pre-wrap wrap-anywhere">
                {attempt.outcome.kind === "rejected"
                  ? attempt.outcome.reason
                  : attempt.outcome.error}
              </p>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

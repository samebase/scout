import type { FunctionReturnType } from "convex/server";
import { ExternalLinkIcon } from "lucide-react";
import { api } from "../../convex/_generated/api";

export type ScoutRun = FunctionReturnType<typeof api.scout.runs.list>[number];
type ScoutRunStatus = ScoutRun["status"];

const runDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const statusDotClasses: Record<ScoutRunStatus, string> = {
  pending: "bg-muted-foreground",
  running: "bg-blue-500",
  needs_human: "bg-amber-500",
  completed: "bg-emerald-500",
  failed: "bg-destructive",
};

type ScoutRunListProps = {
  runs: readonly ScoutRun[] | undefined;
  emptyMessage: string;
};

export function ScoutRunList({ runs, emptyMessage }: ScoutRunListProps) {
  if (runs === undefined) {
    return (
      <p
        className="text-muted-foreground rounded-xl border px-4 py-10 text-center text-sm"
        role="status"
      >
        Loading runs...
      </p>
    );
  }

  if (runs.length === 0) {
    return (
      <p className="text-muted-foreground rounded-xl border px-4 py-10 text-center text-sm">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className="divide-y rounded-xl border" aria-label="Scout runs">
      {runs.map((run) => (
        <li key={run.runId} className="p-4 sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <div className="flex min-w-0 flex-col gap-2">
              <p className="wrap-break-word font-medium">{run.scoutName}</p>
              <RunStatus status={run.status} />
            </div>
            <time
              className="text-muted-foreground shrink-0 text-xs"
              dateTime={new Date(run.updatedAt).toISOString()}
            >
              Updated {runDate.format(run.updatedAt)}
            </time>
          </div>

          <dl className="mt-5 grid gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground text-xs">Mission</dt>
              <dd className="mt-1 wrap-break-word whitespace-pre-wrap">{run.mission}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground text-xs">Target URL</dt>
              <dd className="mt-1 min-w-0">
                <a
                  href={run.targetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-start gap-1.5 wrap-break-word text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="wrap-break-word break-all">{run.targetUrl}</span>
                  <ExternalLinkIcon className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </dd>
            </div>
          </dl>

          {run.summary ? (
            <p className="mt-5 border-t pt-4 text-sm">
              <span className="text-muted-foreground mr-2 text-xs">Summary</span>
              <span className="wrap-break-word">{run.summary}</span>
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function RunStatus({ status }: { status: ScoutRunStatus }) {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
      <span className={`size-2 rounded-full ${statusDotClasses[status]}`} aria-hidden="true" />
      {runStatusLabel(status)}
    </span>
  );
}

function runStatusLabel(status: ScoutRunStatus) {
  switch (status) {
    case "pending":
      return "Pending";
    case "running":
      return "Running";
    case "needs_human":
      return "Needs human";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

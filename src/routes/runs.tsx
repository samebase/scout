import { Navigate, createFileRoute } from "@tanstack/react-router";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ScoutRunList } from "#components/scout-run-list";

export const Route = createFileRoute("/runs")({
  component: RunsPage,
});

function RunsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
      <AuthLoading>
        <p className="text-muted-foreground py-10 text-sm">Loading account...</p>
      </AuthLoading>
      <Unauthenticated>
        <Navigate to="/" replace />
      </Unauthenticated>
      <Authenticated>
        <RunsContent />
      </Authenticated>
    </main>
  );
}

function RunsContent() {
  const runs = useQuery(api.scout.runs.list, {});

  return (
    <>
      <header className="flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <p className="font-mono text-[0.6875rem] tracking-[0.16em] text-muted-foreground uppercase">
            Activity
          </p>
          <h1 className="mt-1 text-2xl font-medium tracking-tight">Runs</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Structured browser missions. Lab experiments remain in Lab.
          </p>
        </div>
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {runs === undefined ? "Loading runs..." : `Showing ${runs.length} recent runs`}
        </p>
      </header>

      <ScoutRunList runs={runs} emptyMessage="No runs are recorded yet." />
    </>
  );
}

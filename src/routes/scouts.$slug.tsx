import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ArrowLeftIcon } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { ScoutRunList } from "#components/scout-run-list";

export const Route = createFileRoute("/scouts/$slug")({
  component: ScoutDetailPage,
});

function ScoutDetailPage() {
  const { slug } = Route.useParams();
  const scout = useQuery(api.scout.scouts.get, { slug });
  const runs = useQuery(api.scout.runs.list, scout ? { scoutId: scout._id } : "skip");

  if (scout === undefined) {
    return (
      <section aria-busy="true" aria-live="polite">
        <p className="text-muted-foreground py-10 text-sm">Loading scout...</p>
      </section>
    );
  }

  if (scout === null) {
    return (
      <section className="flex flex-col gap-4" aria-labelledby="scout-not-found-heading">
        <Link
          to="/scouts"
          className="text-muted-foreground inline-flex w-fit items-center gap-1.5 text-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Back to Scouts
        </Link>
        <div className="rounded-xl border px-4 py-8">
          <h1 id="scout-not-found-heading" className="text-xl font-medium tracking-tight">
            Scout not found
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            No scout matches the slug <code className="font-mono">{slug}</code>.
          </p>
        </div>
      </section>
    );
  }

  const statusLabel = scout.status === "active" ? "Active" : "Disabled";
  const statusDotClass = scout.status === "active" ? "bg-emerald-500" : "bg-muted-foreground";

  return (
    <>
      <header className="flex flex-col gap-4 border-b pb-4">
        <Link
          to="/scouts"
          className="text-muted-foreground inline-flex w-fit items-center gap-1.5 text-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Back to Scouts
        </Link>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div>
            <p className="font-mono text-[0.6875rem] tracking-[0.16em] text-muted-foreground uppercase">
              Scout profile
            </p>
            <h1 className="mt-1 wrap-break-word text-2xl font-medium tracking-tight">
              {scout.displayName}
            </h1>
            <p className="text-muted-foreground mt-1 font-mono text-xs">/{scout.slug}</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-2 text-sm">
            <span className={`size-2 rounded-full ${statusDotClass}`} aria-hidden="true" />
            {statusLabel}
          </span>
        </div>
      </header>

      <section aria-labelledby="scout-configuration-heading">
        <h2 id="scout-configuration-heading" className="text-lg font-medium">
          Configuration
        </h2>
        <dl className="mt-3 grid gap-4 rounded-xl border p-4 text-sm sm:grid-cols-2 sm:p-5">
          <div className="min-w-0">
            <dt className="text-muted-foreground text-xs">AgentMail inbox</dt>
            <dd className="mt-1 wrap-break-word font-mono text-xs">{scout.agentMail.inboxId}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground text-xs">AgentMail address</dt>
            <dd className="mt-1 wrap-break-word">{scout.agentMail.address}</dd>
          </div>
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-muted-foreground text-xs">Firecrawl profile</dt>
            <dd className="mt-1 wrap-break-word">{scout.firecrawl.profileName}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="scout-runs-heading">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="scout-runs-heading" className="text-lg font-medium">
              Recent runs
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Structured missions associated with this Scout.
            </p>
          </div>
          {runs !== undefined ? (
            <p className="text-muted-foreground text-sm" aria-live="polite">
              Showing {runs.length} recent runs
            </p>
          ) : null}
        </div>
        <div className="mt-3">
          <ScoutRunList runs={runs} emptyMessage="No runs are recorded for this scout." />
        </div>
      </section>
    </>
  );
}

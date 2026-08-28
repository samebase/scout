import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";

export const Route = createFileRoute("/scouts/")({
  component: ScoutsIndexPage,
});

type Scout = FunctionReturnType<typeof api.scout.scouts.list>[number];
type ScoutStatus = Scout["status"];

function ScoutsIndexPage() {
  const scouts = useQuery(api.scout.scouts.list);

  return (
    <>
      <header className="flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <p className="font-mono text-[0.6875rem] tracking-[0.16em] text-muted-foreground uppercase">
            Registry
          </p>
          <h1 className="mt-1 text-2xl font-medium tracking-tight">Scouts</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Configured scouts and the services attached to them.
          </p>
        </div>
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {scouts === undefined ? "Loading scouts..." : `Showing ${scouts.length}`}
        </p>
      </header>

      {scouts === undefined ? (
        <p
          className="text-muted-foreground rounded-xl border px-4 py-10 text-center text-sm"
          role="status"
        >
          Loading scouts...
        </p>
      ) : scouts.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border px-4 py-10 text-center text-sm">
          No scouts are registered yet.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border" aria-label="Scouts">
          {scouts.map((scout) => (
            <li key={scout._id}>
              <Link
                to="/scouts/$slug"
                params={{ slug: scout.slug }}
                className="group block rounded-xl p-4 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-5"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                  <div className="min-w-0">
                    <h2 className="wrap-break-word text-base font-medium group-hover:underline group-hover:underline-offset-4">
                      {scout.displayName}
                    </h2>
                    <p className="text-muted-foreground mt-1 font-mono text-xs">/{scout.slug}</p>
                  </div>
                  <ScoutStatus status={scout.status} />
                </div>

                <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="text-muted-foreground text-xs">AgentMail address</dt>
                    <dd className="mt-1 wrap-break-word">{scout.agentMail.address}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground text-xs">Firecrawl profile</dt>
                    <dd className="mt-1 wrap-break-word">{scout.firecrawl.profileName}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ScoutStatus({ status }: { status: ScoutStatus }) {
  const label = status === "active" ? "Active" : "Disabled";
  const dotClass = status === "active" ? "bg-emerald-500" : "bg-muted-foreground";

  return (
    <span className="inline-flex shrink-0 items-center gap-2 text-sm">
      <span className={`size-2 rounded-full ${dotClass}`} aria-hidden="true" />
      {label}
    </span>
  );
}

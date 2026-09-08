import { Link, createFileRoute } from "@tanstack/react-router";
import { usePaginatedQuery } from "convex/react";
import { ArrowRightIcon, GlobeIcon } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Button } from "#components/ui/button";

export const Route = createFileRoute("/sites/")({
  staticData: { access: "access_lab" },
  component: SitesPage,
});

function SitesPage() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.scout.workspaces.listSites,
    {},
    {
      initialNumItems: 50,
    },
  );
  return (
    <main className="route-page max-w-4xl">
      <h1 className="route-heading mb-8">Sites</h1>
      {status === "LoadingFirstPage" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading sites…
        </p>
      ) : results.length === 0 ? (
        <p className="text-sm text-muted-foreground">No shared site workspaces yet.</p>
      ) : (
        <ul className="divide-y rounded-xl border" aria-label="Sites">
          {results.map((site) => (
            <li key={site}>
              <Link
                to="/sites/$site"
                params={{ site }}
                className="flex items-center gap-3 px-4 py-5 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <GlobeIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 break-all">{site}</span>
                <ArrowRightIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <Button
          className="mt-4"
          variant="outline"
          disabled={status === "LoadingMore"}
          onClick={() => loadMore(50)}
        >
          {status === "LoadingMore" ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </main>
  );
}

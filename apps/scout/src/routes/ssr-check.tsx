import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "#components/ui/button";
import { api } from "../../convex/_generated/api";

export const Route = createFileRoute("/ssr-check")({
  staticData: { access: "access_public" },
  head: () => ({
    meta: [{ title: "SSR check | Scout" }, { name: "robots", content: "noindex" }],
  }),
  component: SsrCheckPage,
});

function SsrCheckPage() {
  const [clicks, setClicks] = useState(0);
  const { data: sites } = useSuspenseQuery(
    convexQuery(api.scout.sites.list, {
      scope: "public",
      site: null,
      paginationOpts: { numItems: 3, cursor: null },
    }),
  );

  return (
    <main id="main-content" className="mx-auto max-w-2xl space-y-8 px-6 py-16">
      <header className="space-y-3">
        <h1 className="font-display text-4xl font-medium">SSR check</h1>
        <p className="text-muted-foreground">
          These public sites come from Convex. With SSR enabled, their names and review counts
          appear in View Page Source, before JavaScript runs.
        </p>
      </header>
      <section aria-label="Public sites">
        <h2 className="mb-3 text-lg font-medium">Recent public sites</h2>
        <ul className="divide-y rounded-lg border px-4">
          {sites.page.map((site) => (
            <li key={site.hostname} className="flex items-center justify-between gap-4 py-4">
              <Link
                to="/sites/$site"
                params={{ site: site.hostname }}
                search={{ scope: "public" }}
                className="break-all text-primary underline underline-offset-4"
              >
                {site.hostname}
              </Link>
              <span className="shrink-0 text-sm text-muted-foreground">
                {site.taskCount} public {site.taskCount === 1 ? "review" : "reviews"}
              </span>
            </li>
          ))}
        </ul>
        {sites.page.length === 0 && <p className="mt-3">No public sites yet.</p>}
      </section>
      <section aria-label="Hydration check" className="space-y-3">
        <p className="text-muted-foreground">
          Click the button to check that the page becomes interactive after loading.
        </p>
        <Button onClick={() => setClicks((value) => value + 1)}>Test hydration: {clicks}</Button>
      </section>
      <Link to="/" className="inline-block text-primary underline underline-offset-4">
        Back to the landing page
      </Link>
    </main>
  );
}

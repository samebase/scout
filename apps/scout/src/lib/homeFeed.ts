import { createIsomorphicFn } from "@tanstack/react-start";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

export const loadHomeFeed = createIsomorphicFn()
  .server(async ({ site, scope }: { site: string | null; scope: "public" | "mine" }) => {
    // TanStack's build-time prerender runs before a new backend is deployed.
    // Its static shell uses subscriptions; live HTTP requests await public data.
    if (scope === "mine" || process.env["TSS_PRERENDERING"] === "true") return null;
    const client = new ConvexHttpClient(import.meta.env["VITE_CONVEX_URL"]);
    const [sites, count] = await Promise.all([
      client.query(api.scout.sites.list, {
        site,
        scope: "public",
        paginationOpts: { numItems: 6, cursor: null },
      }),
      client.query(api.scout.sites.count, { scope: "public" }),
    ]);
    const groups = await Promise.all(
      sites.page.map(async (row) => ({
        site: row,
        tasks: await client.query(api.scout.activity.list, {
          site: row.hostname,
          scope: "public",
          paginationOpts: { numItems: 2, cursor: null },
        }),
      })),
    );
    return { site, groups, count, isDone: sites.isDone };
  })
  .client(() => null);

export type HomeFeed = Awaited<ReturnType<typeof loadHomeFeed>>;

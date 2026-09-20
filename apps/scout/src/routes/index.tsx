import { createFileRoute } from "@tanstack/react-router";
import { ProductHome } from "#components/product-home";
import { homeSearch } from "#lib/homeSearch";
import { loadHomeFeed } from "#lib/homeFeed";

export const Route = createFileRoute("/")({
  staticData: { access: "access_public" },
  validateSearch: homeSearch,
  loaderDeps: ({ search }) => ({ site: search.site ?? null, scope: search.scope ?? "public" }),
  loader: ({ deps }) => loadHomeFeed(deps),
  head: () => ({
    meta: [
      { title: "Scout | Website reviews" },
      {
        name: "description",
        content:
          "Ask Scout to try a website and watch what happens. Explore reviews from other users.",
      },
    ],
  }),
  component: () => <ProductHome search={Route.useSearch()} initialFeed={Route.useLoaderData()} />,
});

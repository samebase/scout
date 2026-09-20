import { createFileRoute } from "@tanstack/react-router";
import { ProductHome } from "#components/product-home";
import { homeSearch } from "#lib/homeSearch";

export const Route = createFileRoute("/")({
  ssr: ({ search }) => search.status === "success" && search.value.scope !== "mine",
  staticData: { access: "access_public" },
  validateSearch: homeSearch,
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
  component: () => <ProductHome search={Route.useSearch()} />,
});

import { createFileRoute } from "@tanstack/react-router";
import { ProductHome } from "#components/product-home";
import { reviewFeedSearch } from "#lib/reviewFeedSearch";

export const Route = createFileRoute("/")({
  staticData: { access: "access_public" },
  validateSearch: reviewFeedSearch,
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

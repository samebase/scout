import { createFileRoute } from "@tanstack/react-router";
import { ProductHome } from "#components/product-home";
import { homeSearch } from "#lib/homeSearch";

export const Route = createFileRoute("/")({
  ssr: ({ search }) => search.status === "success" && search.value.scope !== "mine",
  staticData: { access: "access_public" },
  validateSearch: homeSearch,
  head: () => ({
    meta: [
      { title: "TrailScout | Check if a product does what you need" },
      {
        name: "description",
        content:
          "Check if a product does what you need without spending an afternoon trying it. Send an AI agent to try it, inspect screenshots and a replay, or browse existing public reviews.",
      },
    ],
  }),
  component: () => <ProductHome search={Route.useSearch()} />,
});

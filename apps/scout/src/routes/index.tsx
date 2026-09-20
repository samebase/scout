import { createFileRoute } from "@tanstack/react-router";
import { ProductHome } from "#components/product-home";
import { homeSearch } from "#lib/homeSearch";

export const Route = createFileRoute("/")({
  ssr: ({ search }) => search.status === "success" && search.value.scope !== "mine",
  staticData: { access: "access_public" },
  validateSearch: homeSearch,
  head: () => ({
    meta: [
      { title: "Scout | Let Scout try it first" },
      {
        name: "description",
        content:
          "Give Scout a website and something to try. Its AI agents use it in a real browser and show what worked, what failed, and where they got stuck. Browse public reviews before trying it yourself.",
      },
    ],
  }),
  component: () => <ProductHome search={Route.useSearch()} />,
});

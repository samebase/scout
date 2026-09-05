import { createFileRoute } from "@tanstack/react-router";
import { ProductHome } from "#components/product-home";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Scout | Play and Review" },
      {
        name: "description",
        content:
          "Meet Scout Play, a player for your browser game, and Scout Review, a fresh look at your product.",
      },
    ],
  }),
  component: ProductHome,
});

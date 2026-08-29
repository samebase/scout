import { createFileRoute } from "@tanstack/react-router";
import { ProductsWorkspace } from "../components/products-workspace";

export const Route = createFileRoute("/products/$domain/")({
  component: ProductOverviewPage,
});

function ProductOverviewPage() {
  const { domain } = Route.useParams();

  return <ProductsWorkspace domain={domain} />;
}

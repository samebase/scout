import { createFileRoute } from "@tanstack/react-router";
import { ProductsWorkspace } from "../components/products-workspace";

export const Route = createFileRoute("/products/")({
  component: ProductsIndexPage,
});

function ProductsIndexPage() {
  return <ProductsWorkspace />;
}

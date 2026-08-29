import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/products/$domain")({
  component: ProductRouteLayout,
});

function ProductRouteLayout() {
  return <Outlet />;
}

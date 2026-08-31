import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/products/$domain/tasks/$taskId")({
  head: () => ({ meta: [{ title: "Task | Scout" }] }),
  component: TaskRouteLayout,
});

function TaskRouteLayout() {
  return <Outlet />;
}

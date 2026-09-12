import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sites")({
  staticData: { access: "access_lab" },
  head: () => ({ meta: [{ title: "Sites | Scout" }] }),
  component: Outlet,
});

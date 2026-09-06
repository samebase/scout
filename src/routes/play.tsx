import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/play")({
  staticData: { access: "access_public" },
  component: Outlet,
});

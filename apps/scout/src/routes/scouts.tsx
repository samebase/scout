import { Navigate, Outlet, createFileRoute } from "@tanstack/react-router";
import { Authenticated, Unauthenticated } from "convex/react";

export const Route = createFileRoute("/scouts")({
  staticData: { access: "access_scout_view" },
  head: () => ({ meta: [{ title: "Scouts | Scout" }] }),
  component: ScoutsLayout,
});

function ScoutsLayout() {
  return (
    <main className="route-page flex max-w-6xl flex-col gap-8">
      <Unauthenticated>
        <Navigate to="/" replace />
      </Unauthenticated>
      <Authenticated>
        <Outlet />
      </Authenticated>
    </main>
  );
}

import { Navigate, Outlet, createFileRoute } from "@tanstack/react-router";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";

export const Route = createFileRoute("/scouts")({
  component: ScoutsLayout,
});

function ScoutsLayout() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
      <AuthLoading>
        <p className="text-muted-foreground py-10 text-sm">Loading account...</p>
      </AuthLoading>
      <Unauthenticated>
        <Navigate to="/" replace />
      </Unauthenticated>
      <Authenticated>
        <Outlet />
      </Authenticated>
    </main>
  );
}

import { Navigate, Outlet, createFileRoute } from "@tanstack/react-router";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";

export const Route = createFileRoute("/products")({
  component: ProductsLayout,
});

function ProductsLayout() {
  return (
    <div className="flex h-[calc(100dvh-3.25rem)] min-h-0 w-full flex-col">
      <AuthLoading>
        <main className="mx-auto w-full max-w-4xl p-4">
          <p className="text-muted-foreground py-10 text-sm">Loading account...</p>
        </main>
      </AuthLoading>
      <Unauthenticated>
        <Navigate to="/" replace />
      </Unauthenticated>
      <Authenticated>
        <Outlet />
      </Authenticated>
    </div>
  );
}

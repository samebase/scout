import { Link, Outlet, createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";
import { CircleAlertIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "#components/ui/button";

export const Route = createFileRoute("/products/$domain/claims/$claimKey")({
  head: () => ({ meta: [{ title: "Claim attempts | Scout" }] }),
  component: ClaimRouteLayout,
  errorComponent: ClaimRouteError,
});

function ClaimRouteLayout() {
  return <Outlet />;
}

function ClaimRouteError({ reset }: ErrorComponentProps) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm border px-3 py-3">
        <h1 className="flex items-center gap-2 text-sm font-semibold">
          <CircleAlertIcon className="size-4 text-destructive" aria-hidden="true" />
          Claim workspace unavailable
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3">
          <Button type="button" size="xs" onClick={reset}>
            <RotateCcwIcon />
            Retry
          </Button>
          <Button asChild size="xs" variant="ghost">
            <Link to="/products">Products</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
